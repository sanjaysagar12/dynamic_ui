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

export interface ChatDbResponse {
  reply: string;
  messages: ChatMessage[];
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
