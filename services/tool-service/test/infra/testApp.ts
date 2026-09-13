import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import type { ToolRegistry } from '../../src/tools/registry.js';
import { TEST_JWT_SECRET } from './constants.js';

export interface TestApp {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Boots the real tool-service Fastify app (src/app.ts's own createApp —
 * the same entry point src/main.ts uses, not a reimplementation) against
 * the caller's own test Prisma client, on an ephemeral port (so test/http/
 * files can run in parallel without colliding), with JWT_SECRET fixed to
 * TEST_JWT_SECRET so tokens minted by test/infra/testUser.ts (or by the
 * app's own register/login tools, exercised over HTTP) verify correctly.
 *
 * `registry` is optional and only meant for a single spec (test/http/
 * auth-and-confirmation.test.ts's forged-role test) that needs a
 * test-only tool no real caller can reach — pass a ToolRegistry built with
 * its own plugins/enabled list to get an app with only that tool, without
 * touching src/tools/tools.enabled.json.
 *
 * The caller owns `prisma`'s lifecycle: createApp() never auto-disconnects
 * a prisma client it didn't create itself, so disconnect it in the test
 * file's own afterAll (typically after calling close() here).
 */
export async function buildTestApp(prisma: PrismaClient, registry?: ToolRegistry): Promise<TestApp> {
  const app = createApp({ port: 0, databaseUrl: '', jwtSecret: TEST_JWT_SECRET }, prisma, registry);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
}
