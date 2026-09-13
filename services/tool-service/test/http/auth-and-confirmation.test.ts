import { z } from 'zod';
import { randomUUID } from 'node:crypto';
// esModuleInterop is off workspace-wide, and supertest's CJS export is a
// callable function, not an object with a `.default` — import-equals reads
// the raw module.exports (same pattern as registry.ts's enabledList import).
import request = require('supertest');
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { buildTestApp, type TestApp } from '../infra/testApp.js';
import { createTestUser } from '../infra/testUser.js';
import { createUser } from '../factories/users.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { createJob } from '../factories/jobs.js';
import { createPurchaseOrder } from '../factories/purchaseOrders.js';
import { createStockCount } from '../factories/stockCounts.js';
import { createTestMovement } from '../infra/testMovement.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolDefinition } from '../../src/tools/types.js';

describe('HTTP auth + confirmation contract', () => {
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

  it('GET /tools returns 200 with the full catalog and no Authorization header at all', async () => {
    const res = await request(testApp.baseUrl).get('/tools');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tools)).toBe(true);
    expect(res.body.tools.length).toBeGreaterThan(0);
    expect(res.body.tools.some((t: { name: string }) => t.name === 'whoami')).toBe(true);
  });

  it('POST /tools/whoami/execute with no token returns 401', async () => {
    const res = await request(testApp.baseUrl).post('/tools/whoami/execute').send({ args: {} });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('POST /tools/whoami/execute with a garbage/expired token returns 401', async () => {
    const res = await request(testApp.baseUrl)
      .post('/tools/whoami/execute')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ args: {} });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('POST /tools/register/execute succeeds with no Authorization header at all', async () => {
    const email = `http-register-${db.connectionString.length}-${Date.now()}@example.test`;

    const res = await request(testApp.baseUrl)
      .post('/tools/register/execute')
      .send({ args: { email, password: 'a-real-password' }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /tools/login/execute succeeds with no Authorization header at all', async () => {
    const password = 'http-login-password';
    const user = await createUser(prisma, { password });

    const res = await request(testApp.baseUrl)
      .post('/tools/login/execute')
      .send({ args: { email: user.email, password } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /tools/create_material/execute with confirmed omitted returns 409 and writes nothing', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const before = await prisma.material.count();

    const res = await request(testApp.baseUrl)
      .post('/tools/create_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { name: `Unconfirmed Material ${Date.now()}`, uom: 'KG', stockType: 'PER_JOB' } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');

    const after = await prisma.material.count();
    expect(after).toBe(before);
  });

  it('the same call with confirmed: true succeeds', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });

    const res = await request(testApp.baseUrl)
      .post('/tools/create_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { name: `Confirmed Material ${Date.now()}`, uom: 'KG', stockType: 'PER_JOB' }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /tools/set_job_bom/execute with confirmed omitted returns 409 and writes nothing (Batch B)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const job = await createJob(prisma);
    const { material } = await createTestMaterial(prisma);
    const before = await prisma.jobBomLine.count({ where: { jobId: job.id } });

    const res = await request(testApp.baseUrl)
      .post('/tools/set_job_bom/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 1 }] } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    const after = await prisma.jobBomLine.count({ where: { jobId: job.id } });
    expect(after).toBe(before);
  });

  it('POST /tools/create_purchase_order/execute with confirmed omitted returns 409 and writes nothing (Batch C)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const { material } = await createTestMaterial(prisma);
    const before = await prisma.purchaseOrder.count();

    const res = await request(testApp.baseUrl)
      .post('/tools/create_purchase_order/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { supplierName: `Confirm Gate Supplier ${randomUUID()}`, lines: [{ materialId: material.id, quantity: 5, rate: 10 }] } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    const after = await prisma.purchaseOrder.count();
    expect(after).toBe(before);
  });

  it('POST /tools/issue_material/execute with confirmed omitted returns 409 and writes nothing (Batch D)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const job = await createJob(prisma);
    const { material } = await createTestMaterial(prisma);
    const before = await prisma.stockMovement.count({ where: { jobId: job.id } });

    const res = await request(testApp.baseUrl)
      .post('/tools/issue_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { jobId: job.id, lines: [{ materialId: material.id, quantity: 1 }] } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    const after = await prisma.stockMovement.count({ where: { jobId: job.id } });
    expect(after).toBe(before);
  });

  it('POST /tools/record_scrap_in/execute with confirmed omitted returns 409 and writes nothing (Batch E)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const { material } = await createTestMaterial(prisma, { isScrap: true });
    const before = await prisma.stockMovement.count({ where: { materialId: material.id } });

    const res = await request(testApp.baseUrl)
      .post('/tools/record_scrap_in/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { materialId: material.id, quantity: 5 } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    const after = await prisma.stockMovement.count({ where: { materialId: material.id } });
    expect(after).toBe(before);
  });

  it('the same record_scrap_in call with confirmed: true succeeds (Batch E)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const { material } = await createTestMaterial(prisma, { isScrap: true });

    const res = await request(testApp.baseUrl)
      .post('/tools/record_scrap_in/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { materialId: material.id, quantity: 5 }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /tools/record_scrap_sale/execute with confirmed omitted returns 409 and writes nothing (Batch E)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const { material } = await createTestMaterial(prisma, { isScrap: true });
    const before = await prisma.scrapSale.count({ where: { materialId: material.id } });

    const res = await request(testApp.baseUrl)
      .post('/tools/record_scrap_sale/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { materialId: material.id, quantity: 1, rate: 10, saleDate: new Date().toISOString() } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    const after = await prisma.scrapSale.count({ where: { materialId: material.id } });
    expect(after).toBe(before);
  });

  it('the same record_scrap_sale call with confirmed: true succeeds (Batch E)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const { material } = await createTestMaterial(prisma, { isScrap: true });

    const res = await request(testApp.baseUrl)
      .post('/tools/record_scrap_sale/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { materialId: material.id, quantity: 1, rate: 10, saleDate: new Date().toISOString() }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /tools/start_stock_count/execute with confirmed omitted returns 409 and writes nothing (Batch F)', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const before = await prisma.stockCount.count();

    const res = await request(testApp.baseUrl)
      .post('/tools/start_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { countDate: new Date().toISOString() } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    const after = await prisma.stockCount.count();
    expect(after).toBe(before);
  });

  // The authoritative forged-role tests for Batch F's two owner-only tools —
  // approve_stock_count and reject_stock_count are real, shipped
  // requiredRoles: ['OWNER'] tools now, so this uses them directly rather
  // than leaning further on the Phase 2 fixture tool below, per the "prefer
  // real tools once they exist" convention already applied above to
  // approve_purchase_order.
  it('approve_stock_count rejects a STOREKEEPER caller even when the request body claims role: OWNER', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/approve_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { stockCountId: count.id }, confirmed: true, role: 'OWNER' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');

    const unchanged = await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } });
    expect(unchanged.status).toBe('PENDING_APPROVAL');
  });

  it('approve_stock_count allows an OWNER caller through', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'OWNER' });
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/approve_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { stockCountId: count.id }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('reject_stock_count rejects a STOREKEEPER caller even when the request body claims role: OWNER', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/reject_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { stockCountId: count.id, rejectionNote: 'x' }, confirmed: true, role: 'OWNER' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');

    const unchanged = await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } });
    expect(unchanged.status).toBe('PENDING_APPROVAL');
  });

  it('reject_stock_count allows an OWNER caller through', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'OWNER' });
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/reject_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { stockCountId: count.id, rejectionNote: 'x' }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // issue_material is the first *real, shipped* tool with requiredRoles that
  // ISN'T owner-only (['STOREKEEPER', 'OWNER'] — every role in
  // @org/shared-types's ROLES). Since that set is exhaustive (ARCHITECTURE.md
  // §1: ROLES = ['OWNER', 'STOREKEEPER']), there is no real, valid JWT whose
  // role would ever get rejected by issue_material's requiredRoles gate — a
  // "STOREKEEPER-or-OWNER-only" tool is, in this role model, just "any
  // authenticated caller." The forged-role mechanism itself (role resolved
  // from the verified token, never the request body) is already proven above
  // against approve_purchase_order (OWNER-only) and below against the
  // fixture tool — this is noted here explicitly, per the Batch D test plan,
  // rather than forcing a test against a role that can't be constructed.

  // The authoritative forged-role test: approve_purchase_order is a real,
  // shipped tool with requiredRoles: ['OWNER'] (no fixture needed anymore).
  // Sign a valid STOREKEEPER token via the real createTestUser flow, then
  // call the tool with a body that additionally claims role: 'OWNER'
  // alongside valid args — proving role is resolved from the verified JWT,
  // never from the request payload, using real production code end to end.
  it('approve_purchase_order rejects a STOREKEEPER caller even when the request body claims role: OWNER', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/approve_purchase_order/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { purchaseOrderId: po.id }, confirmed: true, role: 'OWNER' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');

    const unchanged = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(unchanged.status).toBe('PENDING_APPROVAL');
  });

  it('approve_purchase_order allows an OWNER caller through', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'OWNER' });
    const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/approve_purchase_order/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { purchaseOrderId: po.id }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // reverse_movement is the SECOND real, shipped requiredRoles: ['OWNER']
  // tool (Batch G) — added as a second real case alongside
  // approve_purchase_order/reject_purchase_order above, per the Batch G test
  // plan, rather than relying solely on the fixture tool below.
  it('reverse_movement rejects a STOREKEEPER caller even when the request body claims role: OWNER', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'STOREKEEPER' });
    const movement = await createTestMovement(prisma);

    const res = await request(testApp.baseUrl)
      .post('/tools/reverse_movement/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { movementId: movement.id, reason: 'not allowed' }, confirmed: true, role: 'OWNER' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');

    const reversalCount = await prisma.stockMovement.count({ where: { reversalOfId: movement.id } });
    expect(reversalCount).toBe(0);
  });

  it('reverse_movement allows an OWNER caller through', async () => {
    const { accessToken } = await createTestUser(prisma, { role: 'OWNER' });
    const movement = await createTestMovement(prisma);

    const res = await request(testApp.baseUrl)
      .post('/tools/reverse_movement/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { movementId: movement.id, reason: 'audit correction' }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // Kept alongside the real approve_purchase_order version above (not
  // removed) — a fixture-tool test still has standalone value: it proves
  // the requiredRoles mechanism itself is sound independent of any one
  // real tool's business logic, and stays meaningful even if
  // approve_purchase_order's own gating ever changes. The real-tool
  // version above is the authoritative one going forward.
  describe('forged-role rejection (fixture tool, kept alongside the real approve_purchase_order test above)', () => {
    let fixtureApp: TestApp;
    let fixturePrisma: PrismaClient;

    const fixtureTool: ToolDefinition<Record<string, never>> = {
      name: 'fixture_owner_only',
      description: 'Test-only fixture tool, requiredRoles: OWNER — never shipped in tools.enabled.json.',
      inputSchema: z.object({}),
      mutates: true,
      requiredRoles: ['OWNER'],
      form: { title: 'Fixture', fields: [] },
      handler: async (ctx) => ({ ok: true, data: { role: ctx.role } }),
    };

    beforeAll(async () => {
      fixturePrisma = getTestPrismaClient(db.connectionString);
      const fixtureRegistry = new ToolRegistry([fixtureTool], ['fixture_owner_only']);
      fixtureApp = await buildTestApp(fixturePrisma, fixtureRegistry);
    });

    afterAll(async () => {
      await fixtureApp.close();
      await fixturePrisma.$disconnect();
    });

    it('rejects a STOREKEEPER caller even when the request body claims role: OWNER', async () => {
      const { accessToken } = await createTestUser(fixturePrisma, { role: 'STOREKEEPER' });

      const res = await request(fixtureApp.baseUrl)
        .post('/tools/fixture_owner_only/execute')
        .set('Authorization', `Bearer ${accessToken}`)
        // role sits alongside args/confirmed, not inside args — the router
        // only ever reads args/confirmed off the body, so this proves role
        // is resolved from the verified token, never from the payload.
        .send({ args: {}, confirmed: true, role: 'OWNER' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('allows an OWNER caller through', async () => {
      const { accessToken } = await createTestUser(fixturePrisma, { role: 'OWNER' });

      const res = await request(fixtureApp.baseUrl)
        .post('/tools/fixture_owner_only/execute')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ args: {}, confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
