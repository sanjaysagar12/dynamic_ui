import 'server-only';
import { getSupabaseServiceUrl } from '../config/env';

export class SupabaseServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SupabaseServiceError';
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return (body && typeof body.error === 'string' && body.error) || `Supabase service error (status ${response.status})`;
}

export interface SupabaseAuthResult {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: string; email: string | null };
  emailConfirmationRequired: boolean;
}

export async function supabaseSignUp(email: string, password: string): Promise<SupabaseAuthResult> {
  const response = await fetch(new URL('/auth/signup', getSupabaseServiceUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new SupabaseServiceError(await parseErrorMessage(response), response.status);
  }
  return response.json();
}

export async function supabaseLogin(email: string, password: string): Promise<SupabaseAuthResult> {
  const response = await fetch(new URL('/auth/login', getSupabaseServiceUrl()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new SupabaseServiceError(await parseErrorMessage(response), response.status);
  }
  return response.json();
}

export interface ProxyDataRequest {
  method: string;
  table: string;
  id?: string;
  accessToken: string;
  userId?: string;
  body?: unknown;
  search?: string;
}

/**
 * Forwards a /data/:table request to the Supabase Service, carrying the caller's
 * Supabase session. Works against any table — the table name comes from the
 * caller (ultimately, from whichever artifact is asking).
 */
export async function proxyDataRequest({
  method,
  table,
  id,
  accessToken,
  userId,
  body,
  search,
}: ProxyDataRequest): Promise<{ status: number; body: unknown }> {
  const path = `/data/${encodeURIComponent(table)}${id ? `/${encodeURIComponent(id)}` : ''}`;
  const url = new URL(path, getSupabaseServiceUrl());
  if (search) {
    url.search = search;
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(userId ? { 'X-User-Id': userId } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
