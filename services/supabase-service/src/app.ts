import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { SupabaseClientFactory } from './supabase/supabase-client-factory.js';
import { AuthService } from './auth/auth.service.js';
import { registerAuthRoutes } from './auth/auth.controller.js';
import { RecordsService } from './data/records.service.js';
import { registerRecordsRoutes } from './data/records.controller.js';
import { RpcService } from './data/rpc.service.js';
import { registerRpcRoutes } from './data/rpc.controller.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Builds (but does not start) the Fastify app: wires the one SupabaseClientFactory into every
 * service, registers every route group, and installs the global error handler. Kept separate
 * from main.ts's `.listen()` call so this function alone is enough to exercise the app (e.g.
 * from a test) without binding a real network port.
 *
 * Route map:
 *   GET  /health              — liveness check, no auth, always 200
 *   /auth/*   (auth.controller.ts)     — signup, login, verify
 *   /data/*   (records.controller.ts) — generic CRUD proxy over any Supabase table
 *   /rpc/*    (rpc.controller.ts)     — generic proxy over any Postgres function (supabase.rpc)
 */
export function createApp(config: AppConfig): FastifyInstance {
  const fastify = Fastify();

  // One factory, shared by every service below — it's the single place that knows how to build
  // a Supabase client (anon or user-scoped) from this service's config (see supabase-client-factory.ts).
  const clientFactory = new SupabaseClientFactory(config);
  const authService = new AuthService(clientFactory);
  const recordsService = new RecordsService(clientFactory);
  const rpcService = new RpcService(clientFactory);

  // Unauthenticated on purpose — used by process managers / uptime checks / the README's
  // "is this service even running" instructions, so it must never depend on Supabase being
  // configured correctly.
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Fastify's `.register()` with a prefix creates an isolated child scope, so hooks added
  // inside registerRecordsRoutes (the requireSupabaseAuth preHandler) apply only to routes
  // registered in that same scope — not to /auth or /health.
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

  fastify.register(
    async (instance) => {
      registerRpcRoutes(instance, rpcService);
    },
    { prefix: '/rpc' },
  );

  // Catches anything a route handler didn't already turn into a response itself (see
  // middleware/error-handler.ts) — without this, an unrecognized error would fall through to
  // Fastify's own default handler, which doesn't log the failure server-side.
  fastify.setErrorHandler(errorHandler);

  return fastify;
}
