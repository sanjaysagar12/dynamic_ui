import type { AppConfig } from '../config.js';
import { ToolServiceAuthError, ToolServiceError } from '../core/errors.js';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutates: boolean;
  destructive: boolean;
  requiredRoles: string[];
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
export class ToolServiceClient {
  private cachedCatalog: { entries: ToolCatalogEntry[]; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfig) {}

  /** GET /tools — caller-independent (no auth required), so this is cached process-wide for
   *  AppConfig.toolCatalogCacheTtlMs rather than fetched on every single chat turn. */
  async fetchToolCatalog(): Promise<ToolCatalogEntry[]> {
    if (this.cachedCatalog && this.cachedCatalog.expiresAt > Date.now()) {
      return this.cachedCatalog.entries;
    }

    const url = new URL('/tools', this.config.toolServiceUrl);
    const response = await this.request(url, {});
    const body = (await response.json()) as { tools?: ToolCatalogEntry[] };
    const entries = body.tools ?? [];
    this.cachedCatalog = { entries, expiresAt: Date.now() + this.config.toolCatalogCacheTtlMs };
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
