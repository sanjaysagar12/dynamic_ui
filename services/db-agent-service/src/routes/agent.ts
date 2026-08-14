import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, SupabaseAuthError } from '../core/errors.js';
import { parseChatDbRequest, ValidationError } from '../schemas.js';
import { DbChatService } from '../services/db-chat-service.js';
import type { SchemaService } from '../services/schema-service.js';
import type { SupabaseQueryClient } from '../services/supabase-query-client.js';

export function registerAgentRoutes(
  fastify: FastifyInstance,
  config: AppConfig,
  supabaseQuery: SupabaseQueryClient,
  schemaService: SchemaService,
): void {
  fastify.post('/agent/chat-db', async (request, reply) => {
    let parsed;
    try {
      parsed = parseChatDbRequest(request.body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(422).send({ detail: err.message });
      }
      throw err;
    }

    try {
      // supabaseQuery/schemaService are shared across requests (constructed once in app.ts) so
      // SchemaService's cache actually persists between turns; DbChatService itself stays
      // cheap and per-request, same as before.
      return await new DbChatService(config, supabaseQuery, schemaService).chat(parsed);
    } catch (err) {
      if (err instanceof SupabaseAuthError) {
        // A real auth failure (missing/invalid/expired Supabase session) — distinct from an
        // RLS-empty query result, which never reaches this branch at all.
        return reply.code(401).send({ detail: err.message });
      }
      if (err instanceof DbAgentGenerationError) {
        return reply.code(502).send({ detail: err.message });
      }
      throw err;
    }
  });
}
