import 'server-only';
import { getToolServiceUrl } from '../config/env';

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

interface ToolResponse {
  status: number;
  body: ToolResult;
}

async function callExecute(name: string, args: unknown, confirmed: boolean | undefined, accessToken?: string): Promise<ToolResponse> {
  const response = await fetch(new URL(`/tools/${encodeURIComponent(name)}/execute`, getToolServiceUrl()), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ args, confirmed }),
    cache: 'no-store',
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : { ok: false, error: 'Empty response from tool-service', code: 'EMPTY_RESPONSE' } };
}

/** Calls tool-service's unauthenticated `login` tool. */
export function toolServiceLogin(email: string, password: string): Promise<ToolResponse> {
  return callExecute('login', { email, password }, undefined);
}

/** Calls tool-service's unauthenticated `register` tool. It's marked `mutates: true`, so
 *  `confirmed: true` is required — submitting the register form IS the user's confirmation,
 *  there's no separate preview step the way a data-bridge write has one. */
export function toolServiceRegister(email: string, password: string, role?: string): Promise<ToolResponse> {
  return callExecute('register', { email, password, ...(role ? { role } : {}) }, true);
}

/** Calls any other (authenticated) tool under the caller's own token — the generic data-bridge path. */
export function executeTool(name: string, args: unknown, confirmed: boolean | undefined, accessToken: string): Promise<ToolResponse> {
  return callExecute(name, args, confirmed, accessToken);
}
