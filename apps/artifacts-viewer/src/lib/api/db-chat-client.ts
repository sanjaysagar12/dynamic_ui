import type { DbChatResponsePayload, SubmitFormRequestPayload } from '../db-chat/types';

export class DbChatRequestError extends Error {}

/** Commits a write from a filled-in, confirmed form (see components/db-chat/DynamicForm.tsx) —
 *  same Bearer-header JWT pattern as chatWithUnifiedAgent. Submitting the form IS the
 *  confirmation; there's no separate "are you sure" step after this. */
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
