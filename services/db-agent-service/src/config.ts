import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '../.env') });

export const DEFAULT_MODEL = 'claude-sonnet-5';

export interface AppConfig {
  port: number;
  toolServiceUrl: string;
  anthropicApiKey: string;
  defaultModel: string;
  // Caps how many tool round-trips a single chat turn can make, so a confused model can't loop
  // against tool-service forever.
  maxToolIterations: number;
  // How long a fetched tool catalog (tool-service-client.ts) is trusted before being re-fetched.
  // GET /tools is caller-independent (no auth, same result for everyone), so caching it
  // process-wide avoids a network round-trip on every chat turn while still picking up a newly
  // enabled/added tool within a few minutes with no code change or redeploy.
  toolCatalogCacheTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // 5003 collided with another service already running on the same host — 5103 avoids it.
    port: Number(env.PORT) || 5103,
    toolServiceUrl: env.TOOL_SERVICE_URL || 'http://localhost:5104',
    // This is the only credential this service holds — it authenticates
    // this process to Anthropic, not to tool-service. Every tool call still
    // goes through tool-service under the caller's own JWT (see
    // services/tool-service-client.ts), so tool-service's own auth/role
    // checks are always what decides what's actually allowed.
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    defaultModel: env.DB_AGENT_MODEL || DEFAULT_MODEL,
    maxToolIterations: Number(env.DB_AGENT_MAX_TOOL_ITERATIONS) || 6,
    toolCatalogCacheTtlMs: (Number(env.DB_AGENT_TOOL_CATALOG_CACHE_TTL_SECONDS) || 300) * 1000,
  };
}
