import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, ToolServiceAuthError, ToolServiceError } from '../core/errors.js';
import type { ChatDbRequest, ChatDbResponse, ChatMessage, SubmitFormRequest } from '../schemas.js';
import { TOOL_RESULT_GUIDANCE } from './tool-guidance.js';
import type { ToolCatalogEntry, ToolResult, ToolServiceClient } from './tool-service-client.js';

/** Builds the Anthropic-facing input schema for one tool — tool-service's own args schema,
 *  unmodified, EXCEPT for a mutating tool's `required` array, which is dropped entirely. A
 *  mutating tool call no longer reaches tool-service directly at all (see runTurn's mutatingUse
 *  short-circuit below) — it only ever supplies prefill hints for the form, real validation
 *  happens later at actual submission. Leaving `required` in place made the model reluctant to
 *  call the tool at all on a vague request ("add a material") since it couldn't satisfy fields
 *  it believed were mandatory to the call itself — dropping it removes that structural pressure,
 *  on top of the prose instruction in the tool description/system prompt telling it the same
 *  thing. A read-only tool's `required` is untouched — those calls execute for real. */
function toInputSchema(entry: ToolCatalogEntry): Anthropic.Tool.InputSchema {
  const raw = isRecord(entry.inputSchema) ? entry.inputSchema : {};
  const properties = isRecord(raw.properties) ? { ...raw.properties } : {};
  const required = entry.mutates
    ? []
    : Array.isArray(raw.required)
      ? raw.required.filter((r): r is string => typeof r === 'string')
      : [];

  return {
    type: 'object',
    properties,
    required,
    ...(typeof raw.additionalProperties === 'boolean' ? { additionalProperties: raw.additionalProperties } : {}),
  };
}

function toToolDescription(entry: ToolCatalogEntry): string {
  if (!entry.mutates) return entry.description;
  return (
    `${entry.description} This action changes data. As soon as the user's intent clearly points to ` +
    'this tool, call it immediately — pass along whatever arguments you can infer from the ' +
    'conversation, or call it with none at all if you can\'t infer any; do NOT ask the user to type ' +
    'the details in chat first, and do NOT wait for a more complete request. Calling this tool never ' +
    'writes anything by itself — it hands the user a structured form (pre-filled with whatever you ' +
    'passed) where they supply, correct, or complete every value and explicitly confirm.'
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

Calling a tool that changes data does NOT write anything by itself — it hands the user a form to
review and confirm, pre-filled with whatever arguments you were able to infer. This means you must
NEVER ask the user clarifying questions in plain text before calling a data-changing tool — not
even when the request is vague or has no details at all ("I need to add a material", "raise a PO"
is already enough). The moment their intent points at a specific tool, call it right away, with
as many arguments as you can infer — zero is fine. The form is the ONLY place details get asked
for; a text question asking "what's the name / unit / quantity?" duplicates what the form already
does and adds a pointless extra round trip. Never claim a change has been made — only the user's
own form submission does that.

When a read-only tool's result comes back, respond with ONE short sentence of framing — never a
markdown table, bulleted list, or restatement of individual rows/values in your text. The result
is rendered directly as a table, chart, or card immediately alongside your sentence, so anything
you repeat from it is pure duplication the user sees twice.

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
    const catalog = await this.toolService.fetchToolCatalog();
    return this.runTurn(model, messages, catalog, request.messages, request.jwt);
  }

  /** Commits a write from a form the user filled in and confirmed (POST /agent/submit-form).
   *  Calls tool-service directly with confirmed: true — form submission IS the confirmation, no
   *  further model round-trip needed to decide whether to proceed. */
  async submitForm(request: SubmitFormRequest): Promise<ChatDbResponse> {
    const catalog = await this.toolService.fetchToolCatalog();
    const entry = catalog.find((e) => e.name === request.toolName);
    if (!entry) {
      return this.textResponse(`Unknown tool "${request.toolName}".`, request.messages);
    }
    if (!entry.mutates) {
      return this.textResponse(`"${request.toolName}" is a read-only tool and can't be submitted as a form.`, request.messages);
    }

    try {
      const result = await this.toolService.executeTool(request.jwt, entry.name, request.args, true);
      if (result.ok) {
        return this.textResponse(`✓ ${describeSuccess(entry, result.data)}`, request.messages);
      }
      // A handler-level rejection (e.g. DUPLICATE_MATERIAL_SUSPECTED, which carries a suggested
      // existing row in `data.suggestion`) is a legitimate outcome the user needs to see and act
      // on — not a silent HTTP error, and not a dead end either. Reopen the same form, prefilled
      // with exactly what they submitted, so they can fix the one offending field instead of
      // retyping the whole request in chat from scratch.
      return this.reopenForm(entry, request, `Couldn't complete that: ${result.error}${describeRejectionDetail(result)}`);
    } catch (err) {
      if (err instanceof ToolServiceAuthError) throw err;
      if (err instanceof ToolServiceError) {
        return this.reopenForm(entry, request, `Couldn't complete that: ${err.message}`);
      }
      throw err;
    }
  }

  private textResponse(text: string, priorMessages: ChatMessage[]): ChatDbResponse {
    return { type: 'text', text, messages: [...priorMessages, { role: 'assistant', content: text }] };
  }

  private reopenForm(entry: ToolCatalogEntry, request: SubmitFormRequest, text: string): ChatDbResponse {
    return {
      type: 'form_request',
      toolName: entry.name,
      form: entry.form!,
      prefill: request.args,
      text,
      messages: [...request.messages, { role: 'assistant', content: text }],
    };
  }

  private async runTurn(
    model: string,
    messages: Anthropic.MessageParam[],
    catalog: ToolCatalogEntry[],
    outwardMessages: ChatMessage[],
    jwt: string,
  ): Promise<ChatDbResponse> {
    const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
    const tools = toAnthropicTools(catalog);
    const systemPrompt = buildSystemPrompt();

    let reply = '';
    let lastRead: { entry: ToolCatalogEntry; data: unknown } | null = null;

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

      // A mutating tool is never actually executed here — it hands control to the form flow
      // instead. If the model asked for one alongside other calls in the same batch, none of
      // this batch is executed; the whole turn ends on the form request.
      const mutatingUse = toolUses.find((tu) => catalogByName.get(tu.name)?.mutates);
      if (mutatingUse) {
        const entry = catalogByName.get(mutatingUse.name)!;
        const framing = textBlocks.map((b) => b.text).join('\n').trim();
        const outward = framing ? [...outwardMessages, { role: 'assistant' as const, content: framing }] : outwardMessages;
        return {
          type: 'form_request',
          toolName: entry.name,
          form: entry.form!,
          prefill: isRecord(mutatingUse.input) ? mutatingUse.input : undefined,
          text: framing || undefined,
          messages: outward,
        };
      }

      messages.push({ role: 'assistant', content: toAssistantContent(response.content) });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const entry = catalogByName.get(toolUse.name);
        const { result, resultBlock } = await this.runReadTool(jwt, toolUse, entry);
        toolResults.push(resultBlock);
        if (entry && result && result.ok) {
          lastRead = { entry, data: result.data };
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!reply) {
      reply = "I wasn't able to find an answer to that — could you rephrase the question?";
    }

    const outwardMessagesNext: ChatMessage[] = [...outwardMessages, { role: 'assistant', content: reply }];

    if (lastRead && lastRead.entry.display) {
      return wrapDisplay(lastRead.entry, lastRead.data, reply, outwardMessagesNext);
    }

    return { type: 'text', text: reply, messages: outwardMessagesNext };
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

  /** Executes one read-only tool call (a mutating one never reaches here — see runTurn). Every
   *  result — success or a handler-level `{ ok: false }` — is fed back to the model as tool_result
   *  content; only a genuine transport/validation/auth failure is `is_error`, and a 401 aborts the
   *  whole turn rather than becoming a tool result at all. */
  private async runReadTool(
    jwt: string,
    toolUse: Anthropic.ToolUseBlock,
    entry: ToolCatalogEntry | undefined,
  ): Promise<{ result: ToolResult | null; resultBlock: Anthropic.ToolResultBlockParam }> {
    if (!entry) {
      return {
        result: null,
        resultBlock: { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Unknown tool "${toolUse.name}"` },
      };
    }

    const args = isRecord(toolUse.input) ? toolUse.input : {};

    try {
      const result = await this.toolService.executeTool(jwt, toolUse.name, args, undefined);
      return { result, resultBlock: { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) } };
    } catch (err) {
      return { result: null, resultBlock: this.toToolResultOrThrow(toolUse.id, err) };
    }
  }

  /** An expired/invalid tool-service session aborts the whole turn (thrown, not fed back to the
   *  model to paper over); any other tool-service-side failure becomes a plain tool error the
   *  model reports honestly instead of guessing at an outcome. */
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

function wrapDisplay(entry: ToolCatalogEntry, data: unknown, text: string, messages: ChatMessage[]): ChatDbResponse {
  const display = entry.display!;
  if (display.type === 'card') {
    const cardData = Array.isArray(data) ? (data[0] as Record<string, unknown>) : (data as Record<string, unknown>);
    return { type: 'card', toolName: entry.name, display, data: cardData ?? {}, text, messages };
  }
  const rows = Array.isArray(data) ? data : [data];
  if (display.type === 'table') {
    return { type: 'table', toolName: entry.name, display, rows, text, messages };
  }
  return { type: 'chart', toolName: entry.name, display, rows, text, messages };
}

/** A handler-level `{ ok: false }` may carry extra structured context beyond its error string
 *  (e.g. create_material's `data.suggestion` — the near-duplicate row it found). Surface it in
 *  plain text rather than dropping it, since the user needs it to decide what to do next. */
function describeRejectionDetail(result: Extract<ToolResult, { ok: false }>): string {
  const data = (result as { data?: unknown }).data;
  if (!isRecord(data)) return '';
  const suggestion = data.suggestion;
  if (isRecord(suggestion)) {
    const label = suggestion.name ?? suggestion.number ?? suggestion.id;
    if (label !== undefined) return ` (existing: ${String(label)})`;
  }
  return '';
}

function describeSuccess(entry: ToolCatalogEntry, data: unknown): string {
  const title = entry.form?.title ?? entry.name;
  if (isRecord(data)) {
    const label = data.number ?? data.name ?? data.id;
    if (label !== undefined) return `${title} — ${String(label)}.`;
  }
  return `${title} completed.`;
}

function toAssistantContent(blocks: Anthropic.ContentBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map((block): Anthropic.ContentBlockParam => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'tool_use') {
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    }
    // Sonnet 5 emits these even with no explicit thinking config requested; they must be replayed
    // back verbatim (including the signature) on the next turn or the API rejects the request —
    // discovered live while verifying multi-turn context continuity, not something toggled here.
    if (block.type === 'thinking') {
      return { type: 'thinking', thinking: block.thinking, signature: block.signature };
    }
    if (block.type === 'redacted_thinking') {
      return { type: 'redacted_thinking', data: block.data };
    }
    // No web-search/code-execution features are enabled, so nothing else is expected.
    throw new DbAgentGenerationError(`Unexpected content block type from Anthropic: ${block.type}`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
