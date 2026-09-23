import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerAgentRoutes } from './routes/agent.js';
import { ToolServiceClient } from './services/tool-service-client.js';

// A caller-supplied toolService (main.ts passes its own instance so it can validate the tool
// catalog against post-write-hooks.ts before the app starts accepting traffic — see main.ts)
// falls back to a fresh one for any other caller (e.g. tests) that doesn't need that.
export function createApp(config: AppConfig, toolService: ToolServiceClient = new ToolServiceClient(config)): FastifyInstance {
  const fastify = Fastify();

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerAgentRoutes(fastify, config, toolService);

  return fastify;
}
