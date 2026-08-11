import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthService } from './auth.service.js';
import { requireSupabaseAuth, getSupabaseAuth } from './require-supabase-auth.js';
import { SupabaseNotConfiguredError, SupabaseRequestError } from '../core/errors.js';

/** Registers POST /signup, POST /login, POST /verify under the /auth prefix (see app.ts).
 *  Each route is a thin HTTP wrapper: parse/validate the request, call the matching
 *  AuthService method, and translate whatever it throws into an HTTP status via handleAuthError.
 *  All the actual Supabase logic lives in auth.service.ts, not here. */
export function registerAuthRoutes(fastify: FastifyInstance, authService: AuthService): void {
  // POST /auth/signup — creates a new Supabase Auth user. No Authorization header needed;
  // there's no session yet, this call is what creates one (or, if email confirmation is
  // required, starts the process that eventually lets the user log in).
  fastify.post('/signup', async (request, reply) => {
    const { email, password } = (request.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      console.warn('POST /auth/signup: rejected — email/password missing or not strings');
      return reply.code(400).send({ error: 'email and password are required' });
    }
    try {
      return await authService.signUp(email, password);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  // POST /auth/login — exchanges email + password for a Supabase session. Also no
  // Authorization header — password is the credential being presented here.
  fastify.post('/login', async (request, reply) => {
    const { email, password } = (request.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      console.warn('POST /auth/login: rejected — email/password missing or not strings');
      return reply.code(400).send({ error: 'email and password are required' });
    }
    try {
      return await authService.signIn(email, password);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  // POST /auth/verify — the identity check every other service in the system calls instead
  // of decoding a Supabase JWT itself. Requires a real Bearer token (requireSupabaseAuth),
  // resolved to { userId, email, role } by AuthService.verify.
  fastify.post('/verify', { preHandler: requireSupabaseAuth }, async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    try {
      return await authService.verify(accessToken);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });
}

/** Shared by all three routes above: converts the two error types AuthService/
 *  SupabaseClientFactory are known to throw into the right HTTP status. Anything else
 *  (a genuine bug) is re-thrown so it reaches middleware/error-handler.ts's catch-all,
 *  which logs it in full and responds 500 instead of this function guessing a status. */
function handleAuthError(err: unknown, reply: FastifyReply) {
  if (err instanceof SupabaseNotConfiguredError) {
    return reply.code(503).send({ error: err.message });
  }
  if (err instanceof SupabaseRequestError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
