// esModuleInterop is off workspace-wide, and supertest's CJS export is a
// callable function, not an object with a `.default` — import-equals reads
// the raw module.exports (same pattern as registry.ts's enabledList import).
import request = require('supertest');
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { buildTestApp, type TestApp } from '../infra/testApp.js';

// Trivial, but establishes the buildTestApp pattern every other test/http/
// file depends on: a real running tool-service instance, over HTTP.
describe('GET /health', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let testApp: TestApp;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    testApp = await buildTestApp(prisma);
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('returns 200 with a minimal ok status', async () => {
    const res = await request(testApp.baseUrl).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
