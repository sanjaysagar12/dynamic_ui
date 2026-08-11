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

/** Registers GET/POST/PATCH/DELETE /:table[/:id] under the /data prefix (see app.ts) — the
 *  generic, schema-agnostic CRUD surface every artifact and both chat agents read/write through.
 *  Every route here requires a Supabase access token (requireSupabaseAuth, applied to the whole
 *  plugin via addHook below) and just forwards to RecordsService, which is where the actual
 *  Supabase calls happen. This file's only job is HTTP plumbing: parse params/query/body,
 *  call the service, map thrown errors to a status code. */
export function registerRecordsRoutes(fastify: FastifyInstance, recordsService: RecordsService): void {
  // Applies to every route registered on this Fastify instance below — there is no
  // unauthenticated route under /data.
  fastify.addHook('preHandler', requireSupabaseAuth);

  // GET /data/:table?col=value&order=col.asc|desc&limit=n — list rows.
  fastify.get<{ Params: TableParams }>('/:table', async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    // Query-string values can technically be string[] (repeated keys) — only keep the plain
    // string ones; RecordsService.list() treats every remaining key as an exact-match filter.
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

  // POST /data/:table { ...fields } — create one row, respond 201 with the row itself (bare,
  // not wrapped in { data: ... } the way the list endpoint is).
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

  // PATCH /data/:table/:id { ...fields } — partial update of one row by id, respond with the
  // row's new state (also bare).
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

  // DELETE /data/:table/:id — delete one row by id, respond 204 with no body.
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

/** Shared by all four routes above — same pattern as auth.controller.ts's handleAuthError:
 *  known error types become the right status code, anything else re-throws to the global
 *  catch-all (middleware/error-handler.ts) so it's logged instead of silently mis-handled. */
function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof SupabaseNotConfiguredError) {
    return reply.code(503).send({ error: err.message });
  }
  if (err instanceof SupabaseRequestError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}
