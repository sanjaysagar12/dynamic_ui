import type { Role } from '@org/shared-auth';

export class TokenRequestError extends Error {}

/** Requests a JWT for the given role via this app's own /api/token route. Client-side. */
export async function fetchToken(role: Role, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`/api/token?role=${encodeURIComponent(role)}`, { signal });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new TokenRequestError(body.error || `Failed to fetch token (status ${response.status})`);
  }

  const data = await response.json();
  return data.token;
}
