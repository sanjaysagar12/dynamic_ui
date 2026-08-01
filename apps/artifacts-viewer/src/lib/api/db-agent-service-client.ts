import 'server-only';
import { getDbAgentServiceUrl } from '../config/env';
import type { DbChatMessage, DbChatResponsePayload } from '../db-chat/types';

export class DbAgentServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DbAgentServiceError';
  }
}

async function parseErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return (body && typeof body.detail === 'string' && body.detail) || `DB agent service error (status ${response.status})`;
}

/** Sends a chat turn to the DB Agent Service, forwarding the caller's own Supabase access token
 *  so it can read data through supabase-service under that token — RLS decides what comes back,
 *  never this service's own judgment. */
export async function chatWithDbAgent(messages: DbChatMessage[], jwt: string): Promise<DbChatResponsePayload> {
  const response = await fetch(new URL('/agent/chat-db', getDbAgentServiceUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, jwt }),
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new DbAgentServiceError(await parseErrorDetail(response), response.status);
  }

  return response.json();
}
