import type { ChatSessionDetailDto, ChatSessionSummaryDto, RenameChatSessionPayload } from '../chat-sessions/types';

export class ChatSessionsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ChatSessionsError';
  }
}

async function parseErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return (body?.error as string) || `Chat sessions request failed (status ${response.status})`;
}

function authHeaders(accessToken: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
}

export async function listChatSessions(accessToken: string): Promise<ChatSessionSummaryDto[]> {
  const response = await fetch('/api/chat/sessions', { headers: authHeaders(accessToken), cache: 'no-store' });
  if (!response.ok) throw new ChatSessionsError(await parseErrorDetail(response), response.status);
  return response.json();
}

export async function getChatSession(sessionId: string, accessToken: string): Promise<ChatSessionDetailDto> {
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { headers: authHeaders(accessToken), cache: 'no-store' });
  if (!response.ok) throw new ChatSessionsError(await parseErrorDetail(response), response.status);
  return response.json();
}

export async function deleteChatSession(sessionId: string, accessToken: string): Promise<void> {
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  });
  if (!response.ok) throw new ChatSessionsError(await parseErrorDetail(response), response.status);
}

export async function renameChatSession(sessionId: string, title: string, accessToken: string): Promise<ChatSessionSummaryDto> {
  const payload: RenameChatSessionPayload = { title };
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ChatSessionsError(await parseErrorDetail(response), response.status);
  return response.json();
}
