export class ValidationError extends Error {}

/** The caller's Supabase JWT was missing, invalid, or expired — a real auth failure, not an RLS-empty result. */
export class SupabaseAuthError extends Error {}

/** supabase-service rejected the query itself (bad table name, malformed filter, upstream failure) —
 *  distinct from a query that succeeded but returned zero rows because RLS filtered everything out. */
export class SupabaseQueryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The Anthropic API call itself failed (network, auth, rate limit, etc.). */
export class DbAgentGenerationError extends Error {}
