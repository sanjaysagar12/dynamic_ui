import 'server-only';
import { getArtifactAgentServiceUrl } from '../config/env';
import type { ChatRequestPayload, ChatResponsePayload, ProvidersResponsePayload } from '../chat/types';
import type { CreateSkillPayload, ListSkillsResponsePayload, Skill, UpdateSkillPayload } from '../skills/types';

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

/** Sends a chat turn to the Agent Service, which drives opencode to generate/update an artifact.
 *  A complex multi-screen artifact can legitimately take several minutes, so this needs an
 *  explicit timeout longer than Node's undici default (~300s) — otherwise the fetch itself gets
 *  aborted client-side before agent-service's own (longer) OPENCODE_TIMEOUT_SECONDS budget is up,
 *  surfacing as a generic network error even though the request was about to succeed. */
export async function chatWithAgent(payload: ChatRequestPayload): Promise<ChatResponsePayload> {
  const response = await fetch(new URL('/agent/chat-artifact', getArtifactAgentServiceUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(950_000),
  });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}

export async function listAgentProviders(): Promise<ProvidersResponsePayload> {
  const response = await fetch(new URL('/agent/providers', getArtifactAgentServiceUrl()), { cache: 'no-store' });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}

export async function listSkillsFromAgent(): Promise<ListSkillsResponsePayload> {
  const response = await fetch(new URL('/agent/skills', getArtifactAgentServiceUrl()), { cache: 'no-store' });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}

export async function createSkillOnAgent(payload: CreateSkillPayload): Promise<Skill> {
  const response = await fetch(new URL('/agent/skills', getArtifactAgentServiceUrl()), {
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

export async function updateSkillOnAgent(name: string, payload: UpdateSkillPayload): Promise<Skill> {
  const response = await fetch(new URL(`/agent/skills/${encodeURIComponent(name)}`, getArtifactAgentServiceUrl()), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}

export async function deleteSkillOnAgent(name: string): Promise<void> {
  const response = await fetch(new URL(`/agent/skills/${encodeURIComponent(name)}`, getArtifactAgentServiceUrl()), {
    method: 'DELETE',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new AgentServiceError(await parseErrorDetail(response), response.status);
  }
}
