import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { SupabaseNotConfiguredError } from '../core/errors.js';

/**
 * Builds every `supabase-js` client this service ever uses. There are exactly two flavors, and
 * deliberately no others:
 *  - an anonymous client (no user context — only valid for the sign-up/sign-in calls that
 *    *establish* a session in the first place), and
 *  - a client scoped to one specific caller's access token (used for literally everything else:
 *    /auth/verify's role lookup, and every /data/:table read/write).
 * Both are built with only the anon/publishable key (see config.ts) — never a secret/service-role
 * key — so Postgres Row-Level Security is always what decides what a request can actually touch,
 * never this service's own code.
 */
export class SupabaseClientFactory {
  constructor(private readonly config: AppConfig) {}

  /** Anonymous client — used only for sign-up/sign-in, which establish a session rather than use one. */
  createAnonClient(): SupabaseClient {
    this.assertConfigured();
    return createClient(this.config.supabaseUrl, this.config.supabaseAnonKey);
  }

  /** A client whose requests carry a specific user's access token, so Postgres RLS policies apply as that user. */
  createUserScopedClient(accessToken: string): SupabaseClient {
    this.assertConfigured();
    return createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      // This client is built fresh per-request and thrown away — it has no session of its own
      // to persist or refresh; the caller's own access token is supplied directly above instead.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Guards both factory methods above: if SUPABASE_URL/SUPABASE_ANON_KEY were never set,
   *  fail fast with a typed error the controllers know to turn into a 503, instead of letting
   *  createClient() build a client that would just fail confusingly on its first real call. */
  private assertConfigured(): void {
    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
      console.warn('SupabaseClientFactory: refusing to build a client — SUPABASE_URL/SUPABASE_ANON_KEY are not configured');
      throw new SupabaseNotConfiguredError();
    }
  }
}
