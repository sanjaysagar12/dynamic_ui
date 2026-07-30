import type { AuthError, Session, User } from '@supabase/supabase-js';
import type { SupabaseClientFactory } from '../supabase/supabase-client-factory.js';
import { SupabaseRequestError } from '../core/errors.js';

/**
 * supabase-js's own error message is unreliable for the exact case that
 * matters most: on a 5xx from Supabase's Auth API, the SDK raises an
 * `AuthRetryableFetchError` whose `.message` is `JSON.stringify()` of an
 * internal object with no enumerable properties — literally the string
 * "{}" — instead of the real `msg` field Supabase's API actually returned.
 * Confirmed live against this project's Auth API returning "Database error
 * querying schema"; the SDK still surfaced only "{}". Fall back to
 * `error.name` + status so the caller gets something actionable instead.
 */
function describeAuthError(error: AuthError): string {
  const message = error.message?.trim();
  if (message && message !== '{}') {
    return message;
  }
  return `${error.name} (Supabase Auth API returned status ${error.status ?? 'unknown'}) — the Auth service may be temporarily unavailable; check the Supabase dashboard's Auth logs.`;
}

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

    // Scoped to the caller's own token so RLS is what actually allows this
    // read, not a service-role bypass. The live `users` table keys directly
    // on the Supabase auth user id (`id` — not a separate `authUserId` FK)
    // and has no `isActive` column; a matching row is itself "active".
    const userScopedClient = this.clientFactory.createUserScopedClient(accessToken);
    const { data: profile, error: profileError } = await userScopedClient
      .from('users')
      .select('role')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (profileError) {
      throw new SupabaseRequestError(profileError.message, 400);
    }
    if (!profile) {
      throw new SupabaseRequestError('No application user found for this account', 403);
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
      throw new SupabaseRequestError(describeAuthError(error), error.status ?? 400);
    }

    return this.toAuthResult(data.session, data.user);
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const client = this.clientFactory.createAnonClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      throw new SupabaseRequestError(describeAuthError(error), error.status ?? 401);
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
