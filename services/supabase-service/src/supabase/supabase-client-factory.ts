import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { SupabaseNotConfiguredError } from '../core/errors.js';

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
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private assertConfigured(): void {
    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
      throw new SupabaseNotConfiguredError();
    }
  }
}
