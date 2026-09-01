import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, ToolServiceAuthError, ToolServiceError } from '../core/errors.js';
import type { ChatDbRequest, ChatDbResponse } from '../schemas.js';
import { TOOL_RESULT_GUIDANCE } from './tool-guidance.js';
import type { ToolCatalogEntry, ToolServiceClient } from './tool-service-client.js';

const CONFIRMED_PROPERTY_DESCRIPTION =
  'Must be true, and must only be true after the user has explicitly confirmed this exact ' +
  'action in their own later message, replying to your prior plain-text explanation of it. ' +
  'Omit or leave false otherwise.';

/** Builds the Anthropic-facing input schema for one tool. A mutating tool gets an extra
 *  `confirmed` property synthesized on top of tool-service's real args schema — tool-service's
 *  own schema never has one (it's a sibling field on the execute request, not part of `args`) —
 *  so the model can set it itself, the same way the old hand-authored `write_table` tool did,
 *  just generic across every mutating tool instead of one hardcoded name. */
function toInputSchema(entry: ToolCatalogEntry): Anthropic.Tool.InputSchema {
  const raw = isRecord(entry.inputSchema) ? entry.inputSchema : {};
  const properties = isRecord(raw.properties) ? { ...raw.properties } : {};
  const required = Array.isArray(raw.required) ? raw.required.filter((r): r is string => typeof r === 'string') : [];

  if (entry.mutates) {
    properties.confirmed = { type: 'boolean', description: CONFIRMED_PROPERTY_DESCRIPTION };
    required.push('confirmed');
  }

  return {
    type: 'object',
    properties,
    required,
    ...(typeof raw.additionalProperties === 'boolean' ? { additionalProperties: raw.additionalProperties } : {}),
  };
}

function toToolDescription(entry: ToolCatalogEntry): string {
  if (!entry.mutates) return entry.description;
  const stakes = entry.destructive ? ' This action is destructive and may not be reversible.' : ' This action changes data.';
  return (
    `${entry.description}${stakes} You MUST NOT call this tool with confirmed: true until you ` +
    'have first replied in plain text — in a previous turn — explaining exactly what you are ' +
    'about to do (which action, and on what), and the user has clearly confirmed that specific ' +
    'action in a later message. Do not call it in the same turn as your explanation.'
  );
}

function toAnthropicTools(catalog: ToolCatalogEntry[]): Anthropic.Tool[] {
  return catalog.map((entry) => ({
    name: entry.name,
    description: toToolDescription(entry),
    input_schema: toInputSchema(entry),
  }));
}

function buildSystemPrompt(): string {
  return `
You are a database assistant for an internal inventory system. Your available tools are listed
for you dynamically, fetched fresh each turn — read each tool's own description and input schema
to know what it does and what arguments it needs; never assume a tool exists beyond what's
actually offered, and never invent arguments a tool's schema doesn't define.

${TOOL_RESULT_GUIDANCE}

Any tool that mutates data requires an explicit confirmed: true argument, and its description
tells you the exact rule: explain the intended change in plain text first and wait, then only
call it again — with confirmed: true — once the user has clearly confirmed that specific action
in a later message. If their reply is ambiguous or changes the request, describe the (possibly
updated) plan again and wait for another explicit confirmation. Never chain multiple mutating
calls off of one confirmation — each distinct change needs its own explanation and its own
confirmation.

If a tool call fails with a genuine error, tell the user briefly that you ran into a problem,
without technical detail, and don't guess at an outcome. Keep answers concise and grounded only
in what the tools actually returned.
`.trim();
}

export class DbChatService {
  private readonly anthropic: Anthropic;

  constructor(
    private readonly config: AppConfig,
    private readonly toolService: ToolServiceClient,
  ) {
    if (!config.anthropicApiKey) {
      throw new DbAgentGenerationError('ANTHROPIC_API_KEY is not configured for db-agent-service');
    }
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async chat(request: ChatDbRequest): Promise<ChatDbResponse> {
    const model = request.model || this.config.defaultModel;
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }));

    // Fetched once per turn; ToolServiceClient itself caches the underlying GET /tools call
    // process-wide, so this isn't a network round-trip on every turn either.
    const catalog = await this.toolService.fetchToolCatalog();
    const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
    const tools = toAnthropicTools(catalog);
    const systemPrompt = buildSystemPrompt();

    let reply = '';
    for (let iteration = 0; iteration < this.config.maxToolIterations; iteration++) {
      // On the last allowed iteration, stop offering tools at all so the model is forced to
      // answer in text instead of requesting yet another round-trip that we won't act on.
      const allowTools = iteration < this.config.maxToolIterations - 1;
      const response = await this.callAnthropic(model, messages, allowTools ? tools : undefined, systemPrompt);

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
      const toolUses = allowTools ? response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use') : [];

      if (toolUses.length === 0) {
        reply = textBlocks.map((b) => b.text).join('\n').trim();
        break;
      }

      messages.push({ role: 'assistant', content: toAssistantContent(response.content) });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        toolResults.push(await this.runTool(request.jwt, toolUse, catalogByName));
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
    tools: Anthropic.Tool[] | undefined,
    systemPrompt: string,
  ): Promise<Anthropic.Message> {
    try {
      return await this.anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
      });
    } catch (err) {
      throw new DbAgentGenerationError(err instanceof Error ? err.message : 'Anthropic API request failed');
    }
  }

  /** Generic dispatch for any tool name the catalog offers — no branch per tool name. A mutating
   *  tool is only ever actually called with `confirmed: true`, and only once the model has set
   *  that itself (see toInputSchema/toToolDescription); tool-service's own 409 is a backstop, not
   *  the primary gate. Every result — success or a handler-level `{ ok: false }` — is fed back to
   *  the model as tool_result content; only a genuine transport/validation/auth failure is
   *  `is_error`, and a 401 aborts the whole turn rather than becoming a tool result at all. */
  private async runTool(
    jwt: string,
    toolUse: Anthropic.ToolUseBlock,
    catalog: Map<string, ToolCatalogEntry>,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const entry = catalog.get(toolUse.name);
    if (!entry) {
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Unknown tool "${toolUse.name}"` };
    }

    const input = isRecord(toolUse.input) ? toolUse.input : {};
    const { confirmed, ...args } = input as Record<string, unknown> & { confirmed?: unknown };

    if (entry.mutates && confirmed !== true) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        is_error: true,
        content:
          'Not confirmed. Explain the exact change to the user in plain text and wait for their ' +
          'explicit confirmation before calling this tool again with confirmed: true.',
      };
    }

    try {
      const result = await this.toolService.executeTool(jwt, entry.name, args, entry.mutates ? true : undefined);
      return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) };
    } catch (err) {
      return this.toToolResultOrThrow(toolUse.id, err);
    }
  }

  /** An expired/invalid tool-service session aborts the whole turn (thrown, not fed back to the
   *  model to paper over); any other tool-service-side failure (unknown tool, invalid args,
   *  forbidden role, unconfirmed mutation) becomes a plain tool error the model reports honestly
   *  instead of guessing at an outcome. */
  private toToolResultOrThrow(toolUseId: string, err: unknown): Anthropic.ToolResultBlockParam {
    if (err instanceof ToolServiceAuthError) {
      throw err;
    }
    if (err instanceof ToolServiceError) {
      return { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: err.message };
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
    // No extended-thinking/web-search/code-execution features are enabled, so text/tool_use are
    // all we ever expect.
    throw new DbAgentGenerationError(`Unexpected content block type from Anthropic: ${block.type}`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
