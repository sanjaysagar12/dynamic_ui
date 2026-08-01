import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { SupabaseClientFactory } from './supabase/supabase-client-factory.js';
import { AuthService } from './auth/auth.service.js';
import { registerAuthRoutes } from './auth/auth.controller.js';
import { RecordsService } from './data/records.service.js';
import { registerRecordsRoutes } from './data/records.controller.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  const clientFactory = new SupabaseClientFactory(config);
  const authService = new AuthService(clientFactory);
  const recordsService = new RecordsService(clientFactory);

  fastify.get('/health', async () => ({ status: 'ok' }));

  fastify.register(
    async (instance) => {
      registerAuthRoutes(instance, authService);
    },
    { prefix: '/auth' },
  );

  fastify.register(
    async (instance) => {
      registerRecordsRoutes(instance, recordsService);
    },
    { prefix: '/data' },
  );

  fastify.setErrorHandler(errorHandler);

  return fastify;
}
