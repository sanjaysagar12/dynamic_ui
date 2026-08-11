/** Thrown by SupabaseClientFactory when SUPABASE_URL/SUPABASE_ANON_KEY are missing.
 *  Every controller catches this and turns it into a 503 — the service is reachable
 *  and /health still works, it's just not able to talk to Supabase yet. */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('SUPABASE_URL / SUPABASE_ANON_KEY are not configured');
    this.name = 'SupabaseNotConfiguredError';
  }
}

/** A request-specific failure with an HTTP status attached, so the controller that catches it
 *  can reply with that exact status instead of a generic 500. Used for both Supabase Auth
 *  failures (invalid credentials, expired token) and Postgres/PostgREST failures (bad table
 *  name, RLS rejection, constraint violation) — the `status` is chosen by whoever throws it. */
export class SupabaseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SupabaseRequestError';
  }
}
