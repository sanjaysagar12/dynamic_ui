import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerAgentRoutes } from './routes/agent.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerAgentRoutes(fastify, config);

  return fastify;
}
