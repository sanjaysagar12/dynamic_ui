import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerAgentRoutes } from './routes/agent.js';
import { ToolServiceClient } from './services/tool-service-client.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  // Constructed once and shared across every request (not per-turn inside DbChatService) so
  // ToolServiceClient's tool-catalog cache actually persists between chat turns instead of being
  // thrown away and rebuilt on every single request.
  const toolService = new ToolServiceClient(config);

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerAgentRoutes(fastify, config, toolService);

  return fastify;
}
