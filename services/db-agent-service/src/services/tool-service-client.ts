import type { AppConfig } from '../config.js';
import { ToolServiceAuthError, ToolServiceError } from '../core/errors.js';
import type { DisplaySpec, FormSpec } from '../schemas.js';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutates: boolean;
  destructive: boolean;
  requiredRoles: string[];
  form?: FormSpec;
  display?: DisplaySpec;
}

export type ToolResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code: string };

async function parseErrorBody(response: Response): Promise<{ message: string; code?: string }> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  const message = (body && typeof body.error === 'string' && body.error) || `tool-service error (status ${response.status})`;
  const code = body && typeof body.code === 'string' ? body.code : undefined;
  return { message, code };
}

/**
 * The only way this service ever touches application data: it forwards the caller's own
 * tool-service JWT to tool-service's generic tool-catalog/tool-execute endpoints — this service
 * holds no database credential and no tool-specific knowledge of its own. Every read or write a
 * model performs goes through a named tool whose own handler (and tool-service's own auth/role
 * checks) is the actual authority on what's allowed, not this client or this service's judgment.
 */
// tool-service now filters GET /tools by the caller's role (approve_purchase_order etc. never
// show up for a STOREKEEPER JWT) — so the catalog is no longer caller-independent. This key
// represents an unauthenticated/no-jwt fetch (main.ts's startup validation, which needs the
// definitive full tool set regardless of any one caller's role), kept distinct from any real role
// string so it can never collide with one.
const UNFILTERED_CACHE_KEY = Symbol('unfiltered');

export class ToolServiceClient {
  // Re-keyed by resolved role (there are only ever a couple), not by caller/JWT — every entry is
  // still only ever populated from tool-service's own signature-verified response for that exact
  // role, so a cache hit can never hand one role's catalog to another's request.
  private readonly catalogCache = new Map<string | typeof UNFILTERED_CACHE_KEY, { entries: ToolCatalogEntry[]; expiresAt: number }>();

  constructor(private readonly config: AppConfig) {}

  /** Resolves the caller's role via tool-service's own POST /auth/verify — the same signature
   *  check GET /tools and every execute call already goes through, just without paying for a full
   *  catalog fetch+serialize on every single chat turn. Used only to pick which per-role cache
   *  bucket to check below; the actual filtering of what a role can see is still done entirely by
   *  tool-service's own GET /tools handler. */
  private async resolveRole(jwt: string): Promise<string> {
    const url = new URL('/auth/verify', this.config.toolServiceUrl);
    const response = await this.request(url, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } });
    const body = (await response.json()) as { role?: unknown };
    if (typeof body.role !== 'string') {
      throw new ToolServiceError('tool-service /auth/verify returned no role', response.status);
    }
    return body.role;
  }

  /** GET /tools, scoped to the caller's role when a jwt is given — tool-service filters out any
   *  tool that role can't call, so a model is never even offered e.g. approve_purchase_order as an
   *  option when the caller is a storekeeper, rather than attempting it and getting a 403 back.
   *  Cached per resolved role for AppConfig.toolCatalogCacheTtlMs, so most calls from an active
   *  session skip both the role check and the (comparatively expensive) catalog build entirely.
   *  Omit `jwt` only for a role-agnostic need for the definitive full tool set (main.ts's startup
   *  validation) — every real request path always has the caller's own jwt. */
  async fetchToolCatalog(jwt?: string): Promise<ToolCatalogEntry[]> {
    const cacheKey = jwt ? await this.resolveRole(jwt) : UNFILTERED_CACHE_KEY;

    const cached = this.catalogCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }

    const url = new URL('/tools', this.config.toolServiceUrl);
    const response = await this.request(url, jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {});
    const body = (await response.json()) as { tools?: ToolCatalogEntry[] };
    const entries = body.tools ?? [];
    this.catalogCache.set(cacheKey, { entries, expiresAt: Date.now() + this.config.toolCatalogCacheTtlMs });
    return entries;
  }

  /** POST /tools/:name/execute. `confirmed` is only meaningful for a mutating tool — omit it (or
   *  pass false) for a read. A 200 response — `{ ok: true, data }` or a handler-level
   *  `{ ok: false, error, code }` — is returned as-is; only a non-2xx response (auth, unknown
   *  tool, invalid args, forbidden role, or an unconfirmed mutation) throws. */
  async executeTool(jwt: string, name: string, args: unknown, confirmed?: boolean): Promise<ToolResult> {
    const url = new URL(`/tools/${encodeURIComponent(name)}/execute`, this.config.toolServiceUrl);
    const response = await this.request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ args, confirmed }),
    });
    return (await response.json()) as ToolResult;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new ToolServiceError(err instanceof Error ? err.message : 'Failed to reach tool-service', 502);
    }

    if (response.status === 401) {
      throw new ToolServiceAuthError('tool-service session is invalid or expired');
    }
    if (!response.ok) {
      const { message, code } = await parseErrorBody(response);
      throw new ToolServiceError(message, response.status, code);
    }
    return response;
  }
}
