import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SupabaseAuthContext {
  accessToken: string;
  userId?: string;
}

// Augments Fastify's own request type so `request.supabaseAuth` is known/typed everywhere,
// instead of every route having to cast `request` to read what this hook attached.
declare module 'fastify' {
  interface FastifyRequest {
    supabaseAuth?: SupabaseAuthContext;
  }
}

/**
 * Fastify `preHandler` hook, registered on every `/data/*` route and on `/auth/verify`
 * (see records.controller.ts / auth.controller.ts). Extracts the Supabase access token from the
 * Authorization header and stashes it on the request for the route handler to read.
 *
 * Note what this does NOT do: it does not call out to Supabase to check the token is valid.
 * That would cost a network round-trip on every single request. Instead the token is handed
 * straight to whichever Supabase client the route builds (via SupabaseClientFactory), and an
 * invalid/expired/forged token simply fails whatever Postgres/Auth call it's used for — Supabase
 * itself is what actually verifies it. Row-level security derives the caller's identity from
 * this token alone, so it's the only thing that's actually required; X-User-Id is optional
 * passthrough metadata some callers attach for their own logging/filtering — nothing in this
 * service currently reads it back out.
 */
export function requireSupabaseAuth(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  const header = request.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    console.warn(`requireSupabaseAuth: rejected ${request.method} ${request.url} — missing/malformed Authorization header`);
    reply.code(401).send({ error: 'Authorization: Bearer <supabase access token> header is required' });
    return;
  }

  const userId = request.headers['x-user-id'];
  request.supabaseAuth = {
    accessToken: header.slice('Bearer '.length).trim(),
    userId: typeof userId === 'string' && userId.length > 0 ? userId : undefined,
  };
  done();
}

/** Reads the context attached by requireSupabaseAuth. Only call this on routes behind that preHandler. */
export function getSupabaseAuth(request: FastifyRequest): SupabaseAuthContext {
  if (!request.supabaseAuth) {
    // Only reachable if a route forgets to register the preHandler above — a wiring bug in this
    // service, not something a caller can trigger, so this throws rather than returning a status.
    throw new Error('getSupabaseAuth() called on a route without requireSupabaseAuth');
  }
  return request.supabaseAuth;
}
