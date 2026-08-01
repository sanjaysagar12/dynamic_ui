import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Catch-all for anything that reaches here without already being turned into
 * a response — i.e. errors the route handlers didn't recognize
 * (SupabaseNotConfiguredError / SupabaseRequestError are handled inline and
 * never reach this). Must be registered via fastify.setErrorHandler.
 *
 * Without this, Fastify's own default error handler took over — matching the
 * Express-era bug this was originally written to avoid, where an unhandled
 * error surfaced an opaque, unlogged response instead of the real cause
 * (confirmed live against Supabase's Auth API returning "Database error
 * querying schema").
 */
export function errorHandler(err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  console.error(`Unhandled error on ${request.method} ${request.url}:`, err);

  const statusCode = (err as FastifyError).statusCode;
  const status = typeof statusCode === 'number' ? statusCode : 500;
  const message = err instanceof Error ? err.message : 'Unexpected server error';

  reply.code(status).send({ error: message });
}
