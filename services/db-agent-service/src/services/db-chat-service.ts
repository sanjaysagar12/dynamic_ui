import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, SupabaseAuthError, SupabaseQueryError } from '../core/errors.js';
import type { ChatDbRequest, ChatDbResponse } from '../schemas.js';
import { DB_SCHEMA_CONTEXT } from './schema-context.js';
import { SupabaseQueryClient } from './supabase-query-client.js';

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
    'Create, update, or delete a single row, scoped to the caller\'s own Supabase permissions ' +
    '(Row-Level Security) — a write the caller isn\'t allowed to make is rejected the same way an ' +
    'unauthorized API call would be. This is destructive/irreversible: you MUST NOT call this tool ' +
    'until you have first replied in plain text explaining exactly what you are about to do — the ' +
    'table, the operation, which row (for update/delete), and the field values involved — and the ' +
    'user has clearly replied confirming that specific action in a later message. Only set ' +
    '`confirmed: true` once that has actually happened; the tool refuses the call otherwise.',
  input_schema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['create', 'update', 'delete'] },
      table: { type: 'string', description: 'Exact table name, e.g. "products".' },
      id: { type: 'string', description: 'Row id — required for update and delete, omitted for create.' },
      fields: {
        type: 'object',
        description: 'Column values to set — required for create and update, omitted for delete.',
        additionalProperties: true,
      },
      confirmed: {
        type: 'boolean',
        description: 'Must be true, and must only be true after the user explicitly confirmed this exact action in their own message.',
      },
    },
    required: ['operation', 'table', 'confirmed'],
  },
};

const SYSTEM_PROMPT = `
You are a database assistant for an internal inventory system. You read data with the
query_table tool, and can create/update/delete rows with the write_table tool. All access is
scoped to the caller's own Supabase permissions via Row-Level Security; you cannot see or change
more than they're allowed to, and must never imply otherwise.

${DB_SCHEMA_CONTEXT}

Before ANY create, update, or delete: reply in plain text first, describing precisely what you
intend to do — the table, the operation, which row (quote identifying details, not just a raw
id, when you have them), and the exact field values — and ask the user to confirm. Do not call
write_table in that same turn. Only call write_table, with confirmed: true, after the user's own
later message clearly agrees to that specific action; if their reply is ambiguous or changes the
request, describe the (possibly updated) plan again and wait for another explicit confirmation.
Never chain multiple writes off of one confirmation — each distinct write needs its own
explanation and its own confirmation.

If a query_table or write_table call fails with a genuine error (marked is_error, distinct from
an empty read result), tell the user briefly that you ran into a problem, without technical
detail, and don't guess at an outcome. Keep answers concise and grounded only in what the tools
actually returned.
`.trim();

export class DbChatService {
  private readonly anthropic: Anthropic;
  private readonly supabaseQuery: SupabaseQueryClient;

  constructor(private readonly config: AppConfig) {
    if (!config.anthropicApiKey) {
      throw new DbAgentGenerationError('ANTHROPIC_API_KEY is not configured for db-agent-service');
    }
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.supabaseQuery = new SupabaseQueryClient(config);
  }

  async chat(request: ChatDbRequest): Promise<ChatDbResponse> {
    const model = request.model || this.config.defaultModel;
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }));

    let reply = '';
    for (let iteration = 0; iteration < this.config.maxToolIterations; iteration++) {
      // On the last allowed iteration, stop offering tools at all so the model is forced to
      // answer in text instead of requesting yet another round-trip that we won't act on.
      const allowTools = iteration < this.config.maxToolIterations - 1;
      const response = await this.callAnthropic(model, messages, allowTools);

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
      const toolUses = allowTools ? response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use') : [];

      if (toolUses.length === 0) {
        reply = textBlocks.map((b) => b.text).join('\n').trim();
        break;
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
      reply,
      messages: [...request.messages, { role: 'assistant', content: reply }],
    };
  }

  private async callAnthropic(model: string, messages: Anthropic.MessageParam[], allowTools: boolean): Promise<Anthropic.Message> {
    try {
      return await this.anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: allowTools ? [QUERY_TABLE_TOOL, WRITE_TABLE_TOOL] : undefined,
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

  private async runWriteTable(jwt: string, toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    const input = toolUse.input as { operation?: unknown; table?: unknown; id?: unknown; fields?: unknown; confirmed?: unknown };

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
    if (input.operation !== 'create' && input.operation !== 'update' && input.operation !== 'delete') {
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'operation must be "create", "update", or "delete"' };
    }

    try {
      if (input.operation === 'create') {
        if (!isRecord(input.fields)) {
          return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'fields is required for create' };
        }
        const created = await this.supabaseQuery.createRow(jwt, input.table, input.fields);
        return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(created) };
      }
      if (input.operation === 'update') {
        if (typeof input.id !== 'string' || !input.id) {
          return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'id is required for update' };
        }
        if (!isRecord(input.fields)) {
          return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'fields is required for update' };
        }
        const updated = await this.supabaseQuery.updateRow(jwt, input.table, input.id, input.fields);
        return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(updated) };
      }
      // delete
      if (typeof input.id !== 'string' || !input.id) {
        return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: 'id is required for delete' };
      }
      await this.supabaseQuery.deleteRow(jwt, input.table, input.id);
      return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ deleted: true, id: input.id }) };
    } catch (err) {
      return this.toToolResultOrThrow(toolUse.id, err, 'The change could not be made (a genuine error, not necessarily a permissions restriction).');
    }
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
