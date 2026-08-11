import type { DbChatMessage, DbChatResponsePayload } from '../db-chat/types';

export class DbChatRequestError extends Error {}

/** `token` is the caller's current Supabase session JWT — the same one the backend's
 *  supabase-service uses to enforce Row-Level Security, sent as a Bearer header so the
 *  /api/chat-db BFF route can forward it to db-agent-service without it ever sitting in the body. */
export async function sendDbChatMessage(messages: DbChatMessage[], token: string): Promise<DbChatResponsePayload> {
  const response = await fetch('/api/chat-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new DbChatRequestError(body.error || `Chat request failed (status ${response.status})`);
  }

  return response.json();
}
