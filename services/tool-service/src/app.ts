import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import { ToolRegistry } from './tools/registry.js';
import { registerToolsRoutes } from './http/tools.router.js';
import { registerAuthVerifyRoute } from './http/auth.router.js';
import { errorHandler } from './middleware/error-handler.js';

// prisma/registry are optional so tests can boot the real app against a
// Testcontainers Postgres (see test/infra/testApp.ts) without a second,
// parallel app-construction path. When a prisma client is supplied by the
// caller, this function doesn't own its lifecycle — the caller disconnects
// it — so app.close() only auto-disconnects a client it created itself.
export function createApp(config: AppConfig, prisma?: PrismaClient, registry: ToolRegistry = new ToolRegistry()): FastifyInstance {
  const fastify = Fastify();

  const ownsPrisma = !prisma;
  const client = prisma ?? new PrismaClient();

  fastify.get('/health', async () => ({ status: 'ok' }));

  registerToolsRoutes(fastify, registry, client, config.jwtSecret);
  registerAuthVerifyRoute(fastify, config.jwtSecret);

  fastify.setErrorHandler(errorHandler);

  if (ownsPrisma) {
    fastify.addHook('onClose', async () => {
      await client.$disconnect();
    });
  }

  return fastify;
}
