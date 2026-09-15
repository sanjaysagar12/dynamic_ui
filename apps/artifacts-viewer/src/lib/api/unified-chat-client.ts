import type { UnifiedChatRequestPayload, UnifiedChatResponsePayload } from '../unified-chat/types';

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
 * Sends a unified chat message that is automatically routed to either
 * the artifact agent (for UI/artifact generation) or database agent
 * (for data manipulation) based on the user's intent.
 */
export async function chatWithUnifiedAgent(payload: UnifiedChatRequestPayload, accessToken?: string): Promise<UnifiedChatResponsePayload> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(950_000),
  });

  if (!response.ok) {
    throw new UnifiedChatError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}
