export interface DbChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What the browser sends to this app's own `/api/chat-db` BFF route — the session's access token
 *  itself travels as an `Authorization: Bearer` header (see lib/http/data-request-auth.ts), not in this body. */
export interface DbChatRequestPayload {
  messages: DbChatMessage[];
}

// Mirrors db-agent-service's src/schemas.ts (which itself mirrors tool-service's
// src/tools/types.ts FormFieldSpec/FormSpec/TableColumnSpec/DisplaySpec) by hand — this repo
// already hand-duplicates its wire types per side rather than sharing them through a package, so
// this follows the same convention instead of a new one.
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

// `display`'s type is coupled to each variant's own `type` field (Extract<DisplaySpec, ...>
// rather than the bare union) so a component keyed on response.type (e.g. `<DynamicTable
// display={pendingRich.display} .../>`) type-checks without an extra runtime narrowing check.
export type DbChatResponsePayload =
  | { type: 'text'; text: string; messages: DbChatMessage[] }
  | { type: 'form_request'; toolName: string; form: FormSpec; prefill?: Record<string, unknown>; text?: string; messages: DbChatMessage[] }
  | {
      type: 'table';
      toolName: string;
      display: Extract<DisplaySpec, { type: 'table' }>;
      rows: Record<string, unknown>[];
      text?: string;
      messages: DbChatMessage[];
    }
  | {
      type: 'chart';
      toolName: string;
      display: Extract<DisplaySpec, { type: 'chart' }>;
      rows: Record<string, unknown>[];
      text?: string;
      messages: DbChatMessage[];
    }
  | {
      type: 'card';
      toolName: string;
      display: Extract<DisplaySpec, { type: 'card' }>;
      data: Record<string, unknown>;
      text?: string;
      messages: DbChatMessage[];
    };

/** What the browser sends to this app's own `/api/submit-form` BFF route — same Bearer-header
 *  JWT pattern as DbChatRequestPayload above. `messages` is the transcript as of the form_request
 *  that produced this form (no server-side conversation store — see db-agent-service's schemas.ts). */
export interface SubmitFormRequestPayload {
  toolName: string;
  args: Record<string, unknown>;
  messages: DbChatMessage[];
}
