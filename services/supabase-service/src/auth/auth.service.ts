import type { Session, User } from '@supabase/supabase-js';
import type { SupabaseClientFactory } from '../supabase/supabase-client-factory.js';
import { SupabaseRequestError } from '../core/errors.js';

export interface AuthResult {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: string; email: string | null };
  emailConfirmationRequired: boolean;
}

export interface VerifiedUser {
  userId: string;
  email: string | null;
  role: string;
}

export class AuthService {
  constructor(private readonly clientFactory: SupabaseClientFactory) {}

  /**
   * The single place in the system that turns a Supabase access token into a
   * trusted identity + app role. Other services (e.g. artifacts-server) call
   * this over HTTP instead of decoding/verifying the JWT themselves, so the
   * Supabase project's auth configuration never has to be shared beyond this
   * service.
   */
  async verify(accessToken: string): Promise<VerifiedUser> {
    const anonClient = this.clientFactory.createAnonClient();
    const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);

    if (userError || !userData.user) {
      throw new SupabaseRequestError('Invalid or expired access token', 401);
    }

    // Scoped to the caller's own token so RLS (users_select_self_or_owner)
    // is what actually allows this read, not a service-role bypass.
    const userScopedClient = this.clientFactory.createUserScopedClient(accessToken);
    const { data: profile, error: profileError } = await userScopedClient
      .from('users')
      .select('role, isActive')
      .eq('authUserId', userData.user.id)
      .maybeSingle();

    if (profileError) {
      throw new SupabaseRequestError(profileError.message, 400);
    }
    if (!profile || !profile.isActive) {
      throw new SupabaseRequestError('No active application user for this account', 403);
    }

    return {
      userId: userData.user.id,
      email: userData.user.email ?? null,
      role: profile.role as string,
    };
  }

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
