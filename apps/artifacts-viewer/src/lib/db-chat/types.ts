export interface DbChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What the browser sends to this app's own `/api/chat-db` BFF route — the Supabase JWT itself
 *  travels as an `Authorization: Bearer` header (see lib/http/data-request-auth.ts), not in this body. */
export interface DbChatRequestPayload {
  messages: DbChatMessage[];
}

// Mirrors db-agent-service's src/schemas.ts FormFieldSpec/FormSpec/ChatDbResponse by hand — this
// repo already hand-duplicates its wire types per side (see DbChatMessage above) rather than
// sharing them through a package, so this follows the same convention instead of a new one.
export interface FormFieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'foreign_key';
  required: boolean;
  default?: unknown;
  options?: { value: unknown; label: string }[];
  referenceTable?: string;
  referenceLabelColumn?: string;
}

export interface FormSpec {
  table: string;
  operation: 'insert' | 'update';
  match?: { id: string };
  fields: FormFieldSpec[];
}

export type DbChatResponsePayload =
  | { type: 'text'; content: string; messages: DbChatMessage[] }
  | { type: 'form_request'; content: string; form: FormSpec; messages: DbChatMessage[] };

/** What the browser sends to this app's own `/api/submit-form` BFF route — same Bearer-header
 *  JWT pattern as DbChatRequestPayload above. */
export interface SubmitFormRequestPayload {
  table: string;
  operation: 'insert' | 'update';
  match?: { id: string };
  values: Record<string, unknown>;
  messages: DbChatMessage[];
}
