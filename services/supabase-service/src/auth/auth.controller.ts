import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthService } from './auth.service.js';
import { requireSupabaseAuth, getSupabaseAuth } from './require-supabase-auth.js';
import { SupabaseNotConfiguredError, SupabaseRequestError } from '../core/errors.js';

export function registerAuthRoutes(fastify: FastifyInstance, authService: AuthService): void {
  fastify.post('/signup', async (request, reply) => {
    const { email, password } = (request.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'email and password are required' });
    }
    try {
      return await authService.signUp(email, password);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password } = (request.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'email and password are required' });
    }
    try {
      return await authService.signIn(email, password);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  fastify.post('/verify', { preHandler: requireSupabaseAuth }, async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    try {
      return await authService.verify(accessToken);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });
}

function handleAuthError(err: unknown, reply: FastifyReply) {
  if (err instanceof SupabaseNotConfiguredError) {
    return reply.code(503).send({ error: err.message });
  }
  if (err instanceof SupabaseRequestError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
