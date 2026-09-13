import { ValidationError } from './core/errors.js';

export { ValidationError };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatDbRequest {
  messages: ChatMessage[];
  // The caller's own tool-service access token — forwarded as-is to tool-service on every tool
  // call, so tool-service's own auth/role checks and each tool's own handler apply as that user.
  // This service never holds a tool-service credential of its own and never decodes this token.
  jwt: string;
  model: string | null;
}

// Hand-mirrors tool-service's src/tools/types.ts FormFieldSpec/FormSpec/TableColumnSpec/DisplaySpec
// — this repo already hand-duplicates its wire types per side (see ChatMessage above, and
// apps/artifacts-viewer's own lib/db-chat/types.ts) rather than sharing them through a package, so
// this follows the same convention instead of introducing a new one.
export type FieldWidget = 'text' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select' | 'foreign_key' | 'line_items';

export interface FormFieldSpec {
  name: string;
  label: string;
  widget: FieldWidget;
  required: boolean;
  helpText?: string;
  defaultValue?: unknown;
  visibleIf?: { field: string; equals: unknown };
  options?: { value: string; label: string }[];
  foreignKey?: {
    tool: string;
    valueField: string;
    labelField: string;
    allowCreate?: boolean;
    args?: Record<string, unknown>;
  };
  itemFields?: FormFieldSpec[];
}

export interface FormSpec {
  title: string;
  fields: FormFieldSpec[];
  submitLabel?: string;
  confirmationCopy?: string;
}

export interface TableColumnSpec {
  field: string;
  label: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'badge';
}

export type DisplaySpec =
  | { type: 'table'; columns: TableColumnSpec[]; highlightIf?: { field: string; op: 'gt' | 'lt' | 'neq'; value: unknown } }
  | { type: 'chart'; chartType: 'line' | 'bar'; xField: string; yField: string; seriesField?: string; title: string }
  | {
      type: 'card';
      fields: { field: string; label: string; format?: TableColumnSpec['format'] }[];
      subTable?: { field: string; title?: string; columns: TableColumnSpec[] };
    };

// Replaces the old single-shape { type: 'text', content, messages } response — every variant still
// carries `messages`, the full updated transcript, because this service keeps no server-side
// conversation state between turns (ARCHITECTURE.md §5): the frontend resends the whole thing next
// turn, so the response has to hand back everything needed to keep doing that, form/table/chart/card
// alike. `text` on the data-bearing variants is Claude's one short sentence of framing alongside the
// structured result (Part 3d) — never a substitute for the structure itself.
export type ChatDbResponse =
  | { type: 'text'; text: string; messages: ChatMessage[] }
  | { type: 'form_request'; toolName: string; form: FormSpec; prefill?: Record<string, unknown>; text?: string; messages: ChatMessage[] }
  | { type: 'table'; toolName: string; display: Extract<DisplaySpec, { type: 'table' }>; rows: unknown[]; text?: string; messages: ChatMessage[] }
  | { type: 'chart'; toolName: string; display: Extract<DisplaySpec, { type: 'chart' }>; rows: unknown[]; text?: string; messages: ChatMessage[] }
  | {
      type: 'card';
      toolName: string;
      display: Extract<DisplaySpec, { type: 'card' }>;
      data: Record<string, unknown>;
      text?: string;
      messages: ChatMessage[];
    };

export function parseChatDbRequest(body: unknown): ChatDbRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new ValidationError('messages must be a non-empty array');
  }
  for (const message of b.messages) {
    const m = message as Record<string, unknown>;
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new ValidationError('each message requires role ("user"|"assistant") and string content');
    }
  }
  if (!isNonEmptyString(b.jwt)) {
    throw new ValidationError('jwt is required and must be the caller\'s tool-service access token');
  }
  return {
    messages: b.messages as ChatMessage[],
    jwt: b.jwt,
    model: isNonEmptyString(b.model) ? b.model : null,
  };
}

// Submitted once the user has filled in (and, per the form's own review step, confirmed) a
// form_request's form. `messages` is the transcript as of when the form was issued — the same
// stateless resend-everything pattern parseChatDbRequest uses, since there's no conversationId
// store here to key a server-side history off of.
export interface SubmitFormRequest {
  messages: ChatMessage[];
  jwt: string;
  toolName: string;
  args: Record<string, unknown>;
}

export function parseSubmitFormRequest(body: unknown): SubmitFormRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.messages)) {
    throw new ValidationError('messages must be an array');
  }
  for (const message of b.messages) {
    const m = message as Record<string, unknown>;
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      throw new ValidationError('each message requires role ("user"|"assistant") and string content');
    }
  }
  if (!isNonEmptyString(b.jwt)) {
    throw new ValidationError('jwt is required and must be the caller\'s tool-service access token');
  }
  if (!isNonEmptyString(b.toolName)) {
    throw new ValidationError('toolName is required');
  }
  if (typeof b.args !== 'object' || b.args === null || Array.isArray(b.args)) {
    throw new ValidationError('args must be an object');
  }
  return {
    messages: b.messages as ChatMessage[],
    jwt: b.jwt,
    toolName: b.toolName,
    args: b.args as Record<string, unknown>,
  };
}
