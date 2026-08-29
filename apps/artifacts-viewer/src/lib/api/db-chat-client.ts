import type { DbChatMessage, DbChatResponsePayload, SubmitFormRequestPayload } from '../db-chat/types';

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

/** Commits a write from a filled-in, confirmed form (see components/db-chat/FormRequestCard.tsx)
 *  — same Bearer-header JWT pattern as sendDbChatMessage above. */
export async function submitDbChatForm(payload: SubmitFormRequestPayload, token: string): Promise<DbChatResponsePayload> {
  const response = await fetch('/api/submit-form', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new DbChatRequestError(body.error || `Form submission failed (status ${response.status})`);
  }

  return response.json();
}
