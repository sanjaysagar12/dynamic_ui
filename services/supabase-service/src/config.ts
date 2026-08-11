import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

// Loaded relative to the compiled file's own location (dist/config.js -> ../.env resolves to
// services/supabase-service/.env), not the process's current working directory, so this works
// the same whether the service is started from its own folder or the workspace root.
loadDotenv({ path: resolve(__dirname, '../.env') });

export interface AppConfig {
  /** HTTP port this service listens on. */
  port: number;
  /** Base URL of the Supabase project, e.g. "https://<project>.supabase.co". */
  supabaseUrl: string;
  /**
   * The Supabase **anon/publishable** key — deliberately never a secret/service-role key.
   * Every Supabase client this service builds (see supabase-client-factory.ts) uses this same
   * key; what actually scopes a request to a specific user is the access token attached to that
   * client's headers, not a different key per caller.
   */
  supabaseAnonKey: string;
}

/** Reads PORT / SUPABASE_URL / SUPABASE_ANON_KEY from the environment (populated from .env
 *  above, or already set by the process's own environment — e.g. in CI/deployment). Missing
 *  Supabase values are not an error here; they just leave the service in an "unconfigured"
 *  state that SupabaseClientFactory.assertConfigured() rejects lazily, per request. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT) || 3335,
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
  };
}
