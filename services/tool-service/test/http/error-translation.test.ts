// esModuleInterop is off workspace-wide, and supertest's CJS export is a
// callable function, not an object with a `.default` — import-equals reads
// the raw module.exports (same pattern as registry.ts's enabledList import).
import request = require('supertest');
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { buildTestApp, type TestApp } from '../infra/testApp.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { withStock } from '../factories/stock.js';
import { createCustomer, createSupplier } from '../factories/parties.js';
import { createPurchaseOrder } from '../factories/purchaseOrders.js';
import { createStockCount } from '../factories/stockCounts.js';
import { createTestMovement } from '../infra/testMovement.js';

const LEAK_SUBSTRINGS = ['ERROR:', 'plpgsql', 'constraint', 'relation'];

function assertNoLeak(res: request.Response): void {
  const serialized = JSON.stringify(res.body);
  for (const needle of LEAK_SUBSTRINGS) {
    expect(serialized).not.toContain(needle);
  }
}

describe('HTTP error translation (over real HTTP, not the handler directly)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let testApp: TestApp;
  let accessToken: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    testApp = await buildTestApp(prisma);
    const user = await createTestUser(prisma, { role: 'STOREKEEPER' });
    accessToken = user.accessToken;
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('create_material duplicate-name path returns the named code over HTTP, with no internal detail leaked', async () => {
    const { material: existing } = await createTestMaterial(prisma, { name: `Duplicate Check ${db.connectionString.length}` });

    const res = await request(testApp.baseUrl)
      .post('/tools/create_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        args: { name: existing.name.toUpperCase(), uom: 'KG', stockType: 'PER_JOB' },
        confirmed: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('DUPLICATE_MATERIAL_SUSPECTED');
    assertNoLeak(res);
  });

  it('deactivate_material MATERIAL_HAS_STOCK path returns the named code over HTTP, with no internal detail leaked', async () => {
    const { material } = await createTestMaterial(prisma);
    await withStock(prisma, material.id, 15, 20);

    const res = await request(testApp.baseUrl)
      .post('/tools/deactivate_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { materialId: material.id, reason: 'no longer needed' }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('MATERIAL_HAS_STOCK');
    assertNoLeak(res);
  });

  it('create_job INVALID_QTY path returns the named code over HTTP, with no internal detail leaked', async () => {
    const customer = await createCustomer(prisma);

    const res = await request(testApp.baseUrl)
      .post('/tools/create_job/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        args: { customerId: customer.id, productDescription: 'Widget', quantity: 0, jobDate: new Date().toISOString() },
        confirmed: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INVALID_QTY');
    assertNoLeak(res);
  });

  it('set_job_bom JOB_NOT_OPEN path returns the named code over HTTP, with no internal detail leaked', async () => {
    const customer = await createCustomer(prisma);
    const job = await prisma.job.create({
      data: {
        number: `JOB-HTTP-${randomUUID()}`,
        customerId: customer.id,
        productDescription: 'Closed job',
        quantity: 10,
        jobDate: new Date(),
        status: 'CLOSED',
      },
    });
    const { material } = await createTestMaterial(prisma);

    const res = await request(testApp.baseUrl)
      .post('/tools/set_job_bom/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { jobId: job.id, lines: [{ materialId: material.id, qtyPerPiece: 1 }] }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('JOB_NOT_OPEN');
    assertNoLeak(res);
  });

  it('create_purchase_order EMPTY_PO and MISSING_RATE paths return the named codes over HTTP, with no internal detail leaked', async () => {
    const emptyRes = await request(testApp.baseUrl)
      .post('/tools/create_purchase_order/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { supplierName: `HTTP Supplier ${randomUUID()}`, lines: [] }, confirmed: true });

    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.ok).toBe(false);
    expect(emptyRes.body.code).toBe('EMPTY_PO');
    assertNoLeak(emptyRes);

    const { material } = await createTestMaterial(prisma);
    const missingRateRes = await request(testApp.baseUrl)
      .post('/tools/create_purchase_order/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        args: { supplierName: `HTTP Supplier ${randomUUID()}`, lines: [{ materialId: material.id, quantity: 10 }] },
        confirmed: true,
      });

    expect(missingRateRes.status).toBe(200);
    expect(missingRateRes.body.ok).toBe(false);
    expect(missingRateRes.body.code).toBe('MISSING_RATE');
    assertNoLeak(missingRateRes);
  });

  it('record_goods_receipt SPLIT_MISMATCH, MISSING_REJECTION_REASON and PO_NOT_APPROVED paths return the named codes over HTTP, with no internal detail leaked', async () => {
    const supplier = await createSupplier(prisma);
    const { material } = await createTestMaterial(prisma);

    const splitRes = await request(testApp.baseUrl)
      .post('/tools/record_goods_receipt/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        args: {
          supplierId: supplier.id,
          receiptDate: new Date().toISOString(),
          lines: [{ materialId: material.id, receivedQty: 10, acceptedQty: 5, rejectedQty: 0, rate: 5 }],
        },
        confirmed: true,
      });
    expect(splitRes.status).toBe(200);
    expect(splitRes.body.code).toBe('SPLIT_MISMATCH');
    assertNoLeak(splitRes);

    const missingReasonRes = await request(testApp.baseUrl)
      .post('/tools/record_goods_receipt/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        args: {
          supplierId: supplier.id,
          receiptDate: new Date().toISOString(),
          lines: [{ materialId: material.id, receivedQty: 10, acceptedQty: 7, rejectedQty: 3, rate: 5 }],
        },
        confirmed: true,
      });
    expect(missingReasonRes.status).toBe(200);
    expect(missingReasonRes.body.code).toBe('MISSING_REJECTION_REASON');
    assertNoLeak(missingReasonRes);

    const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
    // confirmed: true (the generic router gate) but overrideConfirmed
    // omitted from args — this is the end-to-end version of
    // purchasing.test.ts's own override-confirmation regression: proves
    // the router's confirmed gate and this tool's own overrideConfirmed
    // guard are genuinely two separate checks, not just at the handler
    // level but through the real HTTP request shape a caller would send.
    const notApprovedRes = await request(testApp.baseUrl)
      .post('/tools/record_goods_receipt/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        args: {
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          receiptDate: new Date().toISOString(),
          lines: [{ materialId: po.lines[0].materialId, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 100 }],
        },
        confirmed: true,
      });
    expect(notApprovedRes.status).toBe(200);
    expect(notApprovedRes.body.code).toBe('PO_NOT_APPROVED');
    assertNoLeak(notApprovedRes);
  });

  it('approve_purchase_order NOT_PENDING returns the named code over HTTP, with no internal detail leaked', async () => {
    const { accessToken: ownerToken } = await createTestUser(prisma, { role: 'OWNER' });
    const approvedPo = await createPurchaseOrder(prisma, { status: 'APPROVED' });

    const notPendingRes = await request(testApp.baseUrl)
      .post('/tools/approve_purchase_order/execute')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ args: { purchaseOrderId: approvedPo.id }, confirmed: true });
    expect(notPendingRes.status).toBe(200);
    expect(notPendingRes.body.code).toBe('NOT_PENDING');
    assertNoLeak(notPendingRes);
  });

  it('issue_material JOB_NOT_ISSUABLE path returns the named code over HTTP, with no internal detail leaked', async () => {
    const customer = await createCustomer(prisma);
    const job = await prisma.job.create({
      data: {
        number: `JOB-HTTP-${randomUUID()}`,
        customerId: customer.id,
        productDescription: 'Closed job',
        quantity: 10,
        jobDate: new Date(),
        status: 'CLOSED',
      },
    });
    const { material } = await createTestMaterial(prisma);

    const res = await request(testApp.baseUrl)
      .post('/tools/issue_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { jobId: job.id, lines: [{ materialId: material.id, quantity: 1 }] }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('JOB_NOT_ISSUABLE');
    assertNoLeak(res);
  });

  it('return_material NOTHING_ISSUED_FOR_MATERIAL path returns the named code over HTTP, with no internal detail leaked', async () => {
    const customer = await createCustomer(prisma);
    const job = await prisma.job.create({
      data: {
        number: `JOB-HTTP-${randomUUID()}`,
        customerId: customer.id,
        productDescription: 'Nothing issued yet',
        quantity: 10,
        jobDate: new Date(),
      },
    });
    const { material } = await createTestMaterial(prisma);

    const res = await request(testApp.baseUrl)
      .post('/tools/return_material/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { jobId: job.id, lines: [{ materialId: material.id, quantity: 1 }] }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('NOTHING_ISSUED_FOR_MATERIAL');
    assertNoLeak(res);
  });

  it('record_scrap_in NOT_SCRAP_MATERIAL path returns the named code over HTTP, with no internal detail leaked', async () => {
    const { material } = await createTestMaterial(prisma, { isScrap: false });

    const res = await request(testApp.baseUrl)
      .post('/tools/record_scrap_in/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { materialId: material.id, quantity: 5 }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('NOT_SCRAP_MATERIAL');
    assertNoLeak(res);
  });

  // FORBIDDEN_ROLE for a Batch D tool specifically: issue_material/
  // return_material/close_job all allow ['STOREKEEPER', 'OWNER'], which is
  // @org/shared-types's ENTIRE role set (ARCHITECTURE.md §1) — there's no
  // real, valid JWT whose role could ever be rejected by their requiredRoles
  // gate, so no new case is added here for them. The FORBIDDEN_ROLE path
  // itself is already covered above, over real HTTP, by
  // reject_purchase_order's OWNER-only gate.

  // A non-owner caller against reject_purchase_order never actually reaches
  // its own handler-level FORBIDDEN_NOT_OWNER check over real HTTP — the
  // router's requiredRoles gate (tools.router.ts) already rejects it first,
  // as a plain 403/FORBIDDEN_ROLE, before the handler ever runs. The
  // handler's own check is defense-in-depth for a non-router caller (e.g.
  // in-process — see purchasing.test.ts), not a second HTTP-reachable code.
  it('submit_stock_count INCOMPLETE_COUNT path returns the named code over HTTP, with no internal detail leaked', async () => {
    const count = await createStockCount(prisma, { status: 'DRAFT', lines: [{ countedQty: null }] });

    const res = await request(testApp.baseUrl)
      .post('/tools/submit_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { stockCountId: count.id }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INCOMPLETE_COUNT');
    assertNoLeak(res);
  });

  it('approve_stock_count NOT_PENDING path returns the named code over HTTP, with no internal detail leaked', async () => {
    const { accessToken: ownerToken } = await createTestUser(prisma, { role: 'OWNER' });
    const draftCount = await createStockCount(prisma, { status: 'DRAFT' });

    const res = await request(testApp.baseUrl)
      .post('/tools/approve_stock_count/execute')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ args: { stockCountId: draftCount.id }, confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('NOT_PENDING');
    assertNoLeak(res);
  });

  // FORBIDDEN_NOT_OWNER, restated: same finding as auth-and-confirmation.test.ts's
  // reject_purchase_order note below — a non-owner caller against
  // approve_stock_count/reject_stock_count never actually reaches this
  // handler-level code over real HTTP. The router's requiredRoles gate
  // (tools.router.ts) rejects it first, as a plain 403/FORBIDDEN_ROLE, before
  // either handler's own ctx.role !== 'OWNER' check ever runs.
  it('approve_stock_count / reject_stock_count for a non-owner caller are blocked by the router role gate (403 FORBIDDEN_ROLE), not the handler', async () => {
    const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

    const approveRes = await request(testApp.baseUrl)
      .post('/tools/approve_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`) // STOREKEEPER, not OWNER
      .send({ args: { stockCountId: count.id }, confirmed: true });
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.code).toBe('FORBIDDEN_ROLE');
    assertNoLeak(approveRes);

    const rejectRes = await request(testApp.baseUrl)
      .post('/tools/reject_stock_count/execute')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ args: { stockCountId: count.id, rejectionNote: 'x' }, confirmed: true });
    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.code).toBe('FORBIDDEN_ROLE');
    assertNoLeak(rejectRes);
  });

  it('reverse_movement ALREADY_REVERSED path returns the named code over HTTP, with no internal detail leaked', async () => {
    const { accessToken: ownerToken } = await createTestUser(prisma, { role: 'OWNER' });
    const movement = await createTestMovement(prisma);

    const firstRes = await request(testApp.baseUrl)
      .post('/tools/reverse_movement/execute')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ args: { movementId: movement.id, reason: 'first reversal' }, confirmed: true });
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.ok).toBe(true);

    const secondRes = await request(testApp.baseUrl)
      .post('/tools/reverse_movement/execute')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ args: { movementId: movement.id, reason: 'second reversal attempt' }, confirmed: true });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.ok).toBe(false);
    expect(secondRes.body.code).toBe('ALREADY_REVERSED');
    assertNoLeak(secondRes);
  });

  it('reject_purchase_order for a non-owner caller is blocked by the router role gate (403 FORBIDDEN_ROLE), not the handler', async () => {
    const pendingPo = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });

    const res = await request(testApp.baseUrl)
      .post('/tools/reject_purchase_order/execute')
      .set('Authorization', `Bearer ${accessToken}`) // STOREKEEPER, not OWNER
      .send({ args: { purchaseOrderId: pendingPo.id, reason: 'too expensive' }, confirmed: true });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    assertNoLeak(res);
  });
});
