export interface DbChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What the browser sends to this app's own `/api/chat-db` BFF route — the Supabase JWT itself
 *  travels as an `Authorization: Bearer` header (see lib/http/data-request-auth.ts), not in this body. */
export interface DbChatRequestPayload {
  messages: DbChatMessage[];
}

export interface DbChatResponsePayload {
  reply: string;
  messages: DbChatMessage[];
}
