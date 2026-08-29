import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerAgentRoutes } from './routes/agent.js';
import { FormCommitService } from './services/form-commit-service.js';
import { SchemaService } from './services/schema-service.js';
import { SupabaseQueryClient } from './services/supabase-query-client.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  // Constructed once and shared across every request (not per-turn inside DbChatService) so
  // SchemaService's in-memory cache actually persists between chat turns instead of being
  // thrown away and rebuilt on every single request.
  const supabaseQuery = new SupabaseQueryClient(config);
  const schemaService = new SchemaService(supabaseQuery, config);
  const formCommitService = new FormCommitService(supabaseQuery, schemaService);

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerAgentRoutes(fastify, config, supabaseQuery, schemaService, formCommitService);

  return fastify;
}
