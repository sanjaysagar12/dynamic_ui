import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(__dirname, '../.env') });

export const DEFAULT_MODEL = 'claude-opus-4-8';

export interface AppConfig {
  port: number;
  supabaseServiceUrl: string;
  anthropicApiKey: string;
  defaultModel: string;
  // Caps how many query_table tool round-trips a single chat turn can make,
  // so a confused model can't loop against supabase-service forever.
  maxToolIterations: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT) || 5003,
    supabaseServiceUrl: env.SUPABASE_SERVICE_URL || 'http://localhost:3335',
    // This is the only credential this service holds — it authenticates
    // this process to Anthropic, not to Supabase. Every Supabase read still
    // goes through supabase-service under the caller's own JWT (see
    // services/supabase-query-client.ts), so RLS is always the thing that
    // decides what data comes back.
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    defaultModel: env.DB_AGENT_MODEL || DEFAULT_MODEL,
    maxToolIterations: Number(env.DB_AGENT_MAX_TOOL_ITERATIONS) || 6,
  };
}
