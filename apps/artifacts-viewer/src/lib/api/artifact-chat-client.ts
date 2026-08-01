import type { ChatRequestPayload, ChatResponsePayload, ProvidersResponsePayload } from '../chat/types';

export class ChatRequestError extends Error {}

export async function sendChatMessage(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
  const response = await fetch('/api/chat-artifact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ChatRequestError(body.error || `Chat request failed (status ${response.status})`);
  }

  return response.json();
}

export async function fetchProviders(): Promise<ProvidersResponsePayload> {
  const response = await fetch('/api/chat-artifact/providers');

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ChatRequestError(body.error || `Failed to load providers (status ${response.status})`);
  }

  return response.json();
}
