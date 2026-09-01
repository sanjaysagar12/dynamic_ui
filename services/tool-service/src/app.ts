import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import { ToolRegistry } from './tools/registry.js';
import { registerToolsRoutes } from './http/tools.router.js';
import { registerAuthVerifyRoute } from './http/auth.router.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  const prisma = new PrismaClient();
  const registry = new ToolRegistry();

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerToolsRoutes(fastify, registry, prisma, config.jwtSecret);
  registerAuthVerifyRoute(fastify, config.jwtSecret);

  fastify.setErrorHandler(errorHandler);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return fastify;
}
