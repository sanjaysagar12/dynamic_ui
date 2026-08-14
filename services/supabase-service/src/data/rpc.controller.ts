import type { FastifyInstance } from 'fastify';
import type { RpcService } from './rpc.service.js';
import { requireSupabaseAuth, getSupabaseAuth } from '../auth/require-supabase-auth.js';
import { SupabaseNotConfiguredError, SupabaseRequestError } from '../core/errors.js';

interface FunctionParams {
  function: string;
}

/** Registers POST /:function under the /rpc prefix (see app.ts) — the RPC counterpart to
 *  records.controller.ts's /data/:table. Requires a Supabase access token (requireSupabaseAuth),
 *  same as every route under /data. */
export function registerRpcRoutes(fastify: FastifyInstance, rpcService: RpcService): void {
  fastify.addHook('preHandler', requireSupabaseAuth);

  // POST /rpc/:function { ...args } — calls the named Postgres function via PostgREST's own
  // RPC convention, under the caller's own access token. Body fields become the function's
  // named arguments (matching supabase-js's `client.rpc(fn, args)` and PostgREST's own POST
  // /rest/v1/rpc/:fn contract); an empty body calls a zero-argument function.
  fastify.post<{ Params: FunctionParams }>('/:function', async (request, reply) => {
    const { accessToken } = getSupabaseAuth(request);
    try {
      const data = await rpcService.call(accessToken, request.params.function, (request.body ?? {}) as Record<string, unknown>);
      return { data };
    } catch (err) {
      if (err instanceof SupabaseNotConfiguredError) {
        return reply.code(503).send({ error: err.message });
      }
      if (err instanceof SupabaseRequestError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });
}
