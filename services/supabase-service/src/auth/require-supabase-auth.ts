import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SupabaseAuthContext {
  accessToken: string;
  userId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    supabaseAuth?: SupabaseAuthContext;
  }
}

/**
 * Extracts the Supabase access token (Authorization header). Row-level
 * security derives the caller's identity from this token alone, so it's the
 * only thing that's actually required; X-User-Id is optional passthrough
 * metadata some callers use for their own filtering.
 */
export function requireSupabaseAuth(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  const header = request.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
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
    throw new Error('getSupabaseAuth() called on a route without requireSupabaseAuth');
  }
  return request.supabaseAuth;
}
