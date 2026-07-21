import type { Session, User } from '@supabase/supabase-js';
import type { SupabaseClientFactory } from '../supabase/supabase-client-factory.js';
import { SupabaseRequestError } from '../core/errors.js';

export interface AuthResult {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: string; email: string | null };
  emailConfirmationRequired: boolean;
}

export class AuthService {
  constructor(private readonly clientFactory: SupabaseClientFactory) {}

  async signUp(email: string, password: string): Promise<AuthResult> {
    const client = this.clientFactory.createAnonClient();
    const { data, error } = await client.auth.signUp({ email, password });

    if (error) {
      throw new SupabaseRequestError(error.message, error.status ?? 400);
    }

    return this.toAuthResult(data.session, data.user);
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const client = this.clientFactory.createAnonClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      throw new SupabaseRequestError(error.message, error.status ?? 401);
    }

    return this.toAuthResult(data.session, data.user);
  }

  private toAuthResult(session: Session | null, user: User | null): AuthResult {
    return {
      accessToken: session?.access_token ?? null,
      refreshToken: session?.refresh_token ?? null,
      user: { id: user?.id ?? '', email: user?.email ?? null },
      emailConfirmationRequired: session === null,
    };
  }
}
