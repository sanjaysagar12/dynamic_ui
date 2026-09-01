import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Catch-all for anything that reaches here without already being turned into
 * a response by a route handler. Must be registered via fastify.setErrorHandler.
 * Mirrors supabase-service's convention: { error: message } body, full error
 * logged server-side, only the message (never the stack) sent to the caller.
 */
export function errorHandler(err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  console.error(`Unhandled error on ${request.method} ${request.url}:`, err);

  const statusCode = (err as FastifyError).statusCode;
  const status = typeof statusCode === 'number' ? statusCode : 500;
  const message = err instanceof Error ? err.message : 'Unexpected server error';

  reply.code(status).send({ error: message });
}
