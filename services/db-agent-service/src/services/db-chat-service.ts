import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, SupabaseAuthError, SupabaseQueryError } from '../core/errors.js';
import type { ChatDbRequest, ChatDbResponse, FormSpec } from '../schemas.js';
import { buildFormSpec } from './form-spec-builder.js';
import { RLS_BEHAVIOR_GUIDANCE } from './schema-context.js';
import type { SchemaService } from './schema-service.js';
import type { SupabaseQueryClient } from './supabase-query-client.js';

const QUERY_TABLE_TOOL: Anthropic.Tool = {
  name: 'query_table',
  description:
    'Read rows from a single known table, scoped to the caller\'s own Supabase permissions ' +
    '(Row-Level Security). Returns an empty list both when there are no matching rows and when ' +
    'the caller is not permitted to see them — these two cases are indistinguishable on purpose ' +
    'and both simply mean "nothing to report".',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Exact table name, e.g. "products" or "stock_transactions".' },
      filters: {
        type: 'object',
        description: 'Optional exact-match column filters, e.g. {"category_id": "..."}. Values must be strings.',
        additionalProperties: { type: 'string' },
      },
      order: { type: 'string', description: 'Optional sort, "column.asc" or "column.desc".' },
      limit: { type: 'number', description: 'Optional max row count.' },
    },
    required: ['table'],
  },
};

const WRITE_TABLE_TOOL: Anthropic.Tool = {
  name: 'write_table',
  description:
    'Delete a single row, scoped to the caller\'s own Supabase permissions (Row-Level Security) ' +
    '— a write the caller isn\'t allowed to make is rejected the same way an unauthorized API ' +
    'call would be. Do NOT use this tool for create or update — call request_form for those so ' +
    'the user sees and fills a proper form instead of a value you guessed or parsed from prose. ' +
    'This is destructive/irreversible: you MUST NOT call this tool until you have first replied ' +
    'in plain text explaining exactly what you are about to do — the table, the operation, and ' +
    'which row — and the user has clearly replied confirming that specific action in a later ' +
    'message. Only set `confirmed: true` once that has actually happened; the tool refuses the ' +
    'call otherwise.',
  input_schema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['delete'] },
      table: { type: 'string', description: 'Exact table name, e.g. "products".' },
      id: { type: 'string', description: 'Row id to delete.' },
      confirmed: {
        type: 'boolean',
        description: 'Must be true, and must only be true after the user explicitly confirmed this exact action in their own message.',
      },
    },
    required: ['operation', 'table', 'confirmed'],
  },
};

const REQUEST_FORM_TOOL: Anthropic.Tool = {
  name: 'request_form',
  description:
    'Ask the user to fill in (or confirm) the fields for an insert or update through a ' +
    'schema-driven form rendered in the chat, instead of guessing a value or asking a free-text ' +
    'follow-up question. Call this whenever the user\'s request implies creating or updating a ' +
    'row and any field is missing or ambiguous — and still call it, with every value already ' +
    'known filled into known_values, even when nothing is missing, so the user sees and confirms ' +
    'exactly what will be written before it happens. This ends your turn; the actual write only ' +
    'happens if and when the user submits that form, through a separate endpoint you are not ' +
    'involved in — do not also call write_table for the same change.',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'Exact table name, e.g. "products".' },
      operation: { type: 'string', enum: ['insert', 'update'] },
      match: {
        type: 'object',
        description: 'Required for update: { "id": "<row id>" }. Identify the row via query_table first — never guess an id.',
        properties: { id: { type: 'string' } },
      },
      intro: {
        type: 'string',
        description: 'One short sentence shown above the form explaining what it is for, e.g. "Let\'s add the new product."',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Real column names relevant to this write. Any column that is required (NOT NULL, no ' +
          'default) is always included even if you omit it here, so you do not need to enumerate ' +
          'every required column yourself — just the ones worth showing for this specific change.',
      },
      known_values: {
        type: 'object',
        description:
          'Values already confidently known from the conversation or a related record — becomes ' +
          'that field\'s prefilled default. Leave a field out entirely rather than guess.',
        additionalProperties: true,
      },
    },
    required: ['table', 'operation', 'intro'],
  },
};

/** `schemaDescription` comes from SchemaService.describe() — a live read of the actual deployed
 *  schema for this turn, not a hand-maintained copy that can drift from reality. */
function buildSystemPrompt(schemaDescription: string): string {
  return `
You are a database assistant for an internal inventory system. You read data with the
query_table tool. All access is scoped to the caller's own Supabase permissions via Row-Level
Security; you cannot see or change more than they're allowed to, and must never imply otherwise.

${schemaDescription}

${RLS_BEHAVIOR_GUIDANCE}

When the user's request implies inserting or updating a row and any relevant field is missing or
ambiguous, call request_form rather than asking a free-text follow-up question or guessing a
value — never invent a value for a field the user hasn't given you. If every field the write
needs is already known with certainty from the conversation, still call request_form (with
known_values covering all of them) so the user sees and explicitly confirms exactly what will be
written, rather than it happening silently. The write itself only happens if the user submits
that form — you are not involved in that step and must not also call write_table for the same
change.

write_table is for deleting a row only. Before calling it: reply in plain text first, describing
precisely what you intend to do — the table and which row (quote identifying details, not just a
raw id, when you have them) — and ask the user to confirm. Do not call write_table in that same
turn. Only call it, with confirmed: true, after the user's own later message clearly agrees to
that specific action; if their reply is ambiguous or changes the request, describe the (possibly
updated) plan again and wait for another explicit confirmation. Never chain multiple writes off
of one confirmation — each distinct write needs its own explanation and its own confirmation.

If a query_table, write_table, or request_form call fails with a genuine error (marked is_error,
distinct from an empty read result), tell the user briefly that you ran into a problem, without
technical detail, and don't guess at an outcome. Keep answers concise and grounded only in what
the tools actually returned.
`.trim();
}

export class DbChatService {
  private readonly anthropic: Anthropic;

  constructor(
    private readonly config: AppConfig,
    private readonly supabaseQuery: SupabaseQueryClient,
    private readonly schemaService: SchemaService,
  ) {
    if (!config.anthropicApiKey) {
      throw new DbAgentGenerationError('ANTHROPIC_API_KEY is not configured for db-agent-service');
    }
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async chat(request: ChatDbRequest): Promise<ChatDbResponse> {
    const model = request.model || this.config.defaultModel;
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }));
    // Fetched once per turn, cached process-wide inside SchemaService — not re-fetched on every
    // tool round-trip within this same turn's loop below.
    const systemPrompt = buildSystemPrompt(await this.schemaService.describe(request.jwt));

    let reply = '';
    for (let iteration = 0; iteration < this.config.maxToolIterations; iteration++) {
      // On the last allowed iteration, stop offering tools at all so the model is forced to
      // answer in text instead of requesting yet another round-trip that we won't act on.
      const allowTools = iteration < this.config.maxToolIterations - 1;
      const response = await this.callAnthropic(model, messages, allowTools, systemPrompt);

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
      const toolUses = allowTools ? response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use') : [];

      if (toolUses.length === 0) {
        reply = textBlocks.map((b) => b.text).join('\n').trim();
        break;
      }

      // request_form ends the turn the moment it succeeds — the conversation must pause for the
      // user to actually fill and submit the form (a separate endpoint), not keep looping tools.
      // On failure (bad table, missing match.id, ...) it falls through to the normal tool-result
      // handling below instead, so the model can see the error and retry.
      const formToolUse = toolUses.find((t) => t.name === 'request_form');
      if (formToolUse) {
        const outcome = await this.runRequestForm(request.jwt, formToolUse);
        if (outcome.ok) {
          // Safe to return without resolving any sibling tool_use in this same response (unlikely,
          // but possible) — this ends the turn, so `messages` below is never sent back to Anthropic.
          return {
            type: 'form_request',
            content: outcome.intro,
            form: outcome.form,
            messages: [...request.messages, { role: 'assistant', content: outcome.intro }],
          };
        }
        // Failed: the loop continues, so every tool_use in this response still needs a matching
        // tool_result next turn — not just the one that failed — or the next Anthropic call errors.
        messages.push({ role: 'assistant', content: toAssistantContent(response.content) });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          toolResults.push(toolUse.id === formToolUse.id ? outcome.toolResult : await this.runTool(request.jwt, toolUse));
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      messages.push({ role: 'assistant', content: toAssistantContent(response.content) });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        toolResults.push(await this.runTool(request.jwt, toolUse));
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!reply) {
      reply = "I wasn't able to find an answer to that — could you rephrase the question?";
    }

    return {
      type: 'text',
      content: reply,
      messages: [...request.messages, { role: 'assistant', content: reply }],
    };
  }

  private async callAnthropic(
    model: string,
    messages: Anthropic.MessageParam[],
    allowTools: boolean,
    systemPrompt: string,
  ): Promise<Anthropic.Message> {
    try {
      return await this.anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools: allowTools ? [QUERY_TABLE_TOOL, WRITE_TABLE_TOOL, REQUEST_FORM_TOOL] : undefined,
        messages,
      });
    } catch (err) {
      throw new DbAgentGenerationError(err instanceof Error ? err.message : 'Anthropic API request failed');
    }
  }

  private async runTool(jwt: string, toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    if (toolUse.name === 'query_table') {
      return this.runQueryTable(jwt, toolUse);
    }
    if (toolUse.name === 'write_table') {
      return this.runWriteTable(jwt, toolUse);
    }
    return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Unknown tool "${toolUse.name}"` };
  }

  private async runQueryTable(jwt: string, toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    const input = toolUse.input as { table?: unknown; filters?: unknown; order?: unknown; limit?: unknown };
    if (typeof input.table !== 'string' || !input.table) {
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'table is required' };
    }

    try {
      const rows = await this.supabaseQuery.listTable(jwt, {
        table: input.table,
        filters: isStringRecord(input.filters) ? input.filters : undefined,
        order: typeof input.order === 'string' ? input.order : undefined,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      });
      return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(rows) };
    } catch (err) {
      return this.toToolResultOrThrow(toolUse.id, err, 'The query could not be completed (a genuine error, not a permissions restriction).');
    }
  }

  /** Delete-only now — create/update go through request_form + POST /agent/submit-form instead,
   *  so a write's field values always come from a form the user actually saw, never a value this
   *  tool call guessed or parsed out of prose. */
  private async runWriteTable(jwt: string, toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    const input = toolUse.input as { operation?: unknown; table?: unknown; id?: unknown; confirmed?: unknown };

    if (input.confirmed !== true) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        is_error: true,
        content: 'Not confirmed. Explain the exact change to the user in plain text and wait for their explicit confirmation before calling write_table again.',
      };
    }
    if (typeof input.table !== 'string' || !input.table) {
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'table is required' };
    }
    if (input.operation !== 'delete') {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        is_error: true,
        content: 'write_table only supports operation "delete" — use request_form for create/update.',
      };
    }
    if (typeof input.id !== 'string' || !input.id) {
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'id is required for delete' };
    }

    try {
      await this.supabaseQuery.deleteRow(jwt, input.table, input.id);
      return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ deleted: true, id: input.id }) };
    } catch (err) {
      return this.toToolResultOrThrow(toolUse.id, err, 'The change could not be made (a genuine error, not necessarily a permissions restriction).');
    }
  }

  /** Builds the FormSpec for a successful request_form call. Returns a tool-error result instead
   *  (rather than throwing) for anything the model can plausibly fix and retry — an unknown table,
   *  or a missing match.id on an update — so the loop keeps going instead of failing the turn. */
  private async runRequestForm(
    jwt: string,
    toolUse: Anthropic.ToolUseBlock,
  ): Promise<{ ok: true; form: FormSpec; intro: string } | { ok: false; toolResult: Anthropic.ToolResultBlockParam }> {
    const input = toolUse.input as {
      table?: unknown;
      operation?: unknown;
      match?: unknown;
      intro?: unknown;
      fields?: unknown;
      known_values?: unknown;
    };
    const err = (content: string): { ok: false; toolResult: Anthropic.ToolResultBlockParam } => ({
      ok: false,
      toolResult: { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content },
    });

    if (typeof input.table !== 'string' || !input.table) return err('table is required');
    if (input.operation !== 'insert' && input.operation !== 'update') return err('operation must be "insert" or "update"');
    if (typeof input.intro !== 'string' || !input.intro) return err('intro is required');

    let match: { id: string } | undefined;
    if (input.operation === 'update') {
      const m = isRecord(input.match) ? input.match : undefined;
      if (typeof m?.id !== 'string' || !m.id) {
        return err('match.id is required for operation "update" — identify the row via query_table first, do not guess an id.');
      }
      match = { id: m.id };
    }

    const requestedFields = Array.isArray(input.fields) ? input.fields.filter((f): f is string => typeof f === 'string') : [];
    const knownValues = isRecord(input.known_values) ? input.known_values : {};

    const { columns, constraints, enums } = await this.schemaService.getTableInfo(jwt, input.table);
    if (columns.length === 0) {
      return err(`Unknown table "${input.table}" — it isn't in the known schema.`);
    }

    const form = buildFormSpec(input.table, input.operation, requestedFields, knownValues, match, columns, constraints, enums);
    return { ok: true, form, intro: input.intro };
  }

  /** Shared by read and write tools: an expired/invalid session aborts the whole turn (thrown,
   *  not fed back to the model to paper over); any other Supabase-side failure becomes a plain
   *  tool error the model reports honestly instead of guessing at an outcome. */
  private toToolResultOrThrow(toolUseId: string, err: unknown, message: string): Anthropic.ToolResultBlockParam {
    if (err instanceof SupabaseAuthError) {
      throw err;
    }
    if (err instanceof SupabaseQueryError) {
      return { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: message };
    }
    throw err;
  }
}

function toAssistantContent(blocks: Anthropic.ContentBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map((block): Anthropic.ContentBlockParam => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'tool_use') {
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    }
    // The only tools this agent exposes are query_table/write_table, and no extended-thinking/
    // web-search/code-execution features are enabled, so text/tool_use are all we ever expect.
    throw new DbAgentGenerationError(`Unexpected content block type from Anthropic: ${block.type}`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
}
