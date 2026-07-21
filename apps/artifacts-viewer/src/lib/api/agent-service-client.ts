import 'server-only';
import { getAgentServiceUrl } from '../config/env';
import type { ChatRequestPayload, ChatResponsePayload, ProvidersResponsePayload } from '../chat/types';

export class AgentServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AgentServiceError';
  }
}

async function parseErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return (body && typeof body.detail === 'string' && body.detail) || `Agent service error (status ${response.status})`;
}

/** Sends a chat turn to the Agent Service, which generates/updates an artifact via the Tool Service. */
export async function chatWithAgent(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
  const response = await fetch(new URL('/agent/chat', getAgentServiceUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}

export async function listAgentProviders(): Promise<ProvidersResponsePayload> {
  const response = await fetch(new URL('/agent/providers', getAgentServiceUrl()), { cache: 'no-store' });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}
