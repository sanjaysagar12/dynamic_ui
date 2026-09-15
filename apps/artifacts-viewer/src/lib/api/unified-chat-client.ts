import type { ChatTurnRequestPayload, ChatTurnResponsePayload } from '../chat-sessions/types';

export class UnifiedChatError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'UnifiedChatError';
  }
}

async function parseErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return (body && typeof body.detail === 'string' && body.detail) || (body?.error as string) || `Chat service error (status ${response.status})`;
}

/**
 * Sends one chat turn — a `sessionId` (omitted to start a new session) plus the new user
 * message. The server reconstructs prior history from persisted `ChatMessage` rows and routes to
 * whichever backend agent (artifact or database) the message calls for.
 */
export async function chatWithUnifiedAgent(payload: ChatTurnRequestPayload, accessToken: string): Promise<ChatTurnResponsePayload> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(950_000),
  });

  if (!response.ok) {
    throw new UnifiedChatError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}
