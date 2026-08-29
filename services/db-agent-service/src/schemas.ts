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
  // The caller's own Supabase access token — forwarded as-is to
  // supabase-service on every data read, so Postgres RLS policies apply as
  // that user. This service never holds a Supabase key of its own.
  jwt: string;
  model: string | null;
}

// A single input in a schema-driven write form — built from the live Supabase schema
// (SchemaService), never hand-maintained per table. See form-spec-builder.ts.
export interface FormFieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'foreign_key';
  required: boolean;
  // Only ever populated from the model's own `known_values` for this write — a DB-side
  // column default (e.g. now()) never becomes a form default, and a required field with
  // nothing confidently known is left blank rather than guessed.
  default?: unknown;
  options?: { value: unknown; label: string }[];
  referenceTable?: string;
  referenceLabelColumn?: string;
}

export interface FormSpec {
  table: string;
  operation: 'insert' | 'update';
  // supabase-service's PATCH/DELETE /data/:table/:id only ever matches on the `id` column
  // today (records.service.ts), so this mirrors that rather than a generic key set.
  match?: { id: string };
  fields: FormFieldSpec[];
}

export type ChatDbResponse =
  | { type: 'text'; content: string; messages: ChatMessage[] }
  | { type: 'form_request'; content: string; form: FormSpec; messages: ChatMessage[] };

export interface SubmitFormRequest {
  table: string;
  operation: 'insert' | 'update';
  match?: { id: string };
  values: Record<string, unknown>;
  // The transcript so far, so the confirmation reply can extend it coherently — mirrors
  // ChatDbRequest.messages/ChatDbResponse.messages rather than starting a parallel history.
  messages: ChatMessage[];
  jwt: string;
}

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
    throw new ValidationError('jwt is required and must be the caller\'s Supabase access token');
  }
  return {
    messages: b.messages as ChatMessage[],
    jwt: b.jwt,
    model: isNonEmptyString(b.model) ? b.model : null,
  };
}

function parseMatch(value: unknown): { id: string } | undefined {
  if (value === undefined || value === null) return undefined;
  const m = value as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) {
    throw new ValidationError('match.id must be a non-empty string when provided');
  }
  return { id: m.id };
}

export function parseSubmitFormRequest(body: unknown): SubmitFormRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(b.table)) {
    throw new ValidationError('table is required');
  }
  if (b.operation !== 'insert' && b.operation !== 'update') {
    throw new ValidationError('operation must be "insert" or "update"');
  }
  const match = parseMatch(b.match);
  if (b.operation === 'update' && !match) {
    throw new ValidationError('match.id is required for operation "update"');
  }
  if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values)) {
    throw new ValidationError('values must be an object of column -> value');
  }
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
    throw new ValidationError('jwt is required and must be the caller\'s Supabase access token');
  }
  return {
    table: b.table,
    operation: b.operation,
    match,
    values: b.values as Record<string, unknown>,
    messages: b.messages as ChatMessage[],
    jwt: b.jwt,
  };
}
