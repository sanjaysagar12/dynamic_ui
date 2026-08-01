import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerSkillsRoutes } from './routes/skills.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerAgentRoutes(fastify, config);
  registerSkillsRoutes(fastify, config);

  return fastify;
}
