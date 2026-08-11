import type { AppConfig } from '../config.js';
import { SupabaseAuthError, SupabaseQueryError } from '../core/errors.js';

export interface QueryTableParams {
  table: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
}

async function parseErrorBody(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return (body && typeof body.error === 'string' && body.error) || `supabase-service error (status ${response.status})`;
}

/**
 * The only way this service ever touches Supabase data: it forwards the
 * caller's own Supabase access token to supabase-service's generic
 * `/data/:table` endpoints (anon-key-only, RLS-scoped to that token) — never
 * a service-role/admin key, and never a direct Supabase client of its own.
 * This is deliberate: every part of the system that needs to read or write
 * Supabase data on behalf of a user goes through supabase-service, so RLS is
 * always the thing deciding what's actually allowed, not this agent's own
 * judgment.
 */
export class SupabaseQueryClient {
  constructor(private readonly config: AppConfig) {}

  async listTable(jwt: string, params: QueryTableParams): Promise<unknown[]> {
    const { table, filters = {}, order, limit } = params;

    const search = new URLSearchParams(filters);
    if (order) search.set('order', order);
    if (limit != null) search.set('limit', String(limit));

    const url = new URL(`/data/${encodeURIComponent(table)}`, this.config.supabaseServiceUrl);
    url.search = search.toString();

    const response = await this.request(url, { headers: { Authorization: `Bearer ${jwt}` } });

    const body = (await response.json()) as { data?: unknown[] };
    // A 200 with an empty array is a normal, successful outcome — it's what
    // both "no matching rows" and "RLS filtered every row out" look like,
    // indistinguishable by design. Callers must not treat this as an error,
    // and must not try to tell those two cases apart in their response.
    return body.data ?? [];
  }

  async createRow(jwt: string, table: string, fields: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`/data/${encodeURIComponent(table)}`, this.config.supabaseServiceUrl);
    const response = await this.request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    return response.json();
  }

  async updateRow(jwt: string, table: string, id: string, fields: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, this.config.supabaseServiceUrl);
    const response = await this.request(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    return response.json();
  }

  async deleteRow(jwt: string, table: string, id: string): Promise<void> {
    const url = new URL(`/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, this.config.supabaseServiceUrl);
    await this.request(url, { method: 'DELETE', headers: { Authorization: `Bearer ${jwt}` } });
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new SupabaseQueryError(err instanceof Error ? err.message : 'Failed to reach supabase-service', 502);
    }

    if (response.status === 401) {
      throw new SupabaseAuthError('Supabase session is invalid or expired');
    }
    if (!response.ok) {
      throw new SupabaseQueryError(await parseErrorBody(response), response.status);
    }
    return response;
  }
}
