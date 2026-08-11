import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { DbAgentGenerationError, SupabaseAuthError } from '../core/errors.js';
import { parseChatDbRequest, ValidationError } from '../schemas.js';
import { DbChatService } from '../services/db-chat-service.js';

export function registerAgentRoutes(fastify: FastifyInstance, config: AppConfig): void {
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
      return await new DbChatService(config).chat(parsed);
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
