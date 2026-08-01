import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RecordsService } from './records.service.js';
import { requireSupabaseAuth, getSupabaseAuth } from '../auth/require-supabase-auth.js';
import { SupabaseNotConfiguredError, SupabaseRequestError } from '../core/errors.js';

interface TableParams {
  table: string;
}

interface TableIdParams {
  table: string;
  id: string;
}

export function registerRecordsRoutes(fastify: FastifyInstance, recordsService: RecordsService): void {
  fastify.addHook('preHandler', requireSupabaseAuth);

  fastify.get<{ Params: TableParams }>('/:table', async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    const filters = Object.fromEntries(
      Object.entries(request.query as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    try {
      return { data: await recordsService.list(accessToken, request.params.table, filters) };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.post<{ Params: TableParams }>('/:table', async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    try {
      const created = await recordsService.create(
        accessToken,
        request.params.table,
        (request.body ?? {}) as Record<string, unknown>,
      );
      return reply.code(201).send(created);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.patch<{ Params: TableIdParams }>('/:table/:id', async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    try {
      return await recordsService.update(
        accessToken,
        request.params.table,
        request.params.id,
        (request.body ?? {}) as Record<string, unknown>,
      );
    } catch (err) {
      return handleError(err, reply);
    }
  });

  fastify.delete<{ Params: TableIdParams }>('/:table/:id', async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    try {
      await recordsService.remove(accessToken, request.params.table, request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof SupabaseNotConfiguredError) {
    return reply.code(503).send({ error: err.message });
  }
  if (err instanceof SupabaseRequestError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
