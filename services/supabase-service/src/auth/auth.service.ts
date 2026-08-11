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

/** Wire shape returned by both POST /auth/signup and POST /auth/login (see auth.controller.ts).
 *  accessToken/refreshToken are null exactly when emailConfirmationRequired is true. */
export interface AuthResult {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: string; email: string | null };
  emailConfirmationRequired: boolean;
}

/** Wire shape returned by POST /auth/verify — the identity + role every other service trusts. */
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
    // Step 1: is this even a real, current Supabase session? getUser() round-trips to
    // Supabase's Auth API to check the token — it does not just decode it locally, so an
    // expired or revoked token is caught here even though it might still look well-formed.
    const anonClient = this.clientFactory.createAnonClient();
    const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);

    if (userError || !userData.user) {
      console.warn('AuthService.verify: rejected — invalid or expired access token');
      throw new SupabaseRequestError('Invalid or expired access token', 401);
    }

    // Step 2: does this auth user have a corresponding row in *our* application's `users`
    // table, and if so what role does it have? Scoped to the caller's own token so RLS is
    // what actually allows this read, not a service-role bypass. The live `users` table keys
    // directly on the Supabase auth user id (`id` — not a separate `authUserId` FK) and has no
    // `isActive` column; a matching row is itself "active".
    const userScopedClient = this.clientFactory.createUserScopedClient(accessToken);
    const { data: profile, error: profileError } = await userScopedClient
      .from('users')
      .select('role')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error(`AuthService.verify: role lookup failed for user ${userData.user.id}:`, profileError.message);
      throw new SupabaseRequestError(profileError.message, 400);
    }
    if (!profile) {
      // A real Supabase Auth account exists, but nobody ever created (or RLS is hiding) the
      // matching `users` row — treated as "not a recognized application user", not a 401,
      // since the token itself was genuinely valid.
      console.warn(`AuthService.verify: no application 'users' row for auth user ${userData.user.id}`);
      throw new SupabaseRequestError('No application user found for this account', 403);
    }

    console.log(`AuthService.verify: ok — user ${userData.user.id} (${userData.user.email}) role=${profile.role}`);
    return {
      userId: userData.user.id,
      email: userData.user.email ?? null,
      role: profile.role as string,
    };
  }

  /** Creates a new Supabase Auth user. Uses an anonymous client since there's no session yet
   *  to scope this to — this call is what *creates* one. */
  async signUp(email: string, password: string): Promise<AuthResult> {
    const client = this.clientFactory.createAnonClient();
    const { data, error } = await client.auth.signUp({ email, password });

    if (error) {
      console.warn(`AuthService.signUp: failed for ${email}:`, describeAuthError(error));
      throw new SupabaseRequestError(describeAuthError(error), error.status ?? 400);
    }

    const result = this.toAuthResult(data.session, data.user);
    console.log(
      `AuthService.signUp: ${email} -> user ${result.user.id}` +
        (result.emailConfirmationRequired ? ' (email confirmation required before login)' : ' (session issued)'),
    );
    return result;
  }

  /** Signs an existing user in with email + password. Password is never logged — only the
   *  outcome (success/failure) and the email address are. */
  async signIn(email: string, password: string): Promise<AuthResult> {
    const client = this.clientFactory.createAnonClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      console.warn(`AuthService.signIn: failed for ${email}:`, describeAuthError(error));
      throw new SupabaseRequestError(describeAuthError(error), error.status ?? 401);
    }

    console.log(`AuthService.signIn: ${email} -> user ${data.user?.id} (session issued)`);
    return this.toAuthResult(data.session, data.user);
  }

  /** Normalizes supabase-js's { session, user } shape into this service's own wire format
   *  (see auth.controller.ts) — a session of null means Supabase is configured to require
   *  email confirmation before it will issue one, not that something failed. */
  private toAuthResult(session: Session | null, user: User | null): AuthResult {
    return {
      accessToken: session?.access_token ?? null,
      refreshToken: session?.refresh_token ?? null,
      user: { id: user?.id ?? '', email: user?.email ?? null },
      emailConfirmationRequired: session === null,
    };
  }
}
