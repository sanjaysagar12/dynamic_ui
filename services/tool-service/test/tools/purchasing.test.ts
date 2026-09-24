import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createMaterial } from '../factories/materials.js';
import { createSupplier } from '../factories/parties.js';
import { createPurchaseOrder } from '../factories/purchaseOrders.js';
import type { ToolContext } from '../../src/tools/types.js';
import createPurchaseOrderTool from '../../src/tools/plugins/create_purchase_order.js';
import approvePurchaseOrderTool from '../../src/tools/plugins/approve_purchase_order.js';
import rejectPurchaseOrderTool from '../../src/tools/plugins/reject_purchase_order.js';
import recordGoodsReceiptTool from '../../src/tools/plugins/record_goods_receipt.js';
import getPurchasePriceHistoryTool from '../../src/tools/plugins/get_purchase_price_history.js';
import listPendingApprovalsTool from '../../src/tools/plugins/list_pending_approvals.js';

describe('purchasing tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let storekeeperCtx: ToolContext;
  let ownerCtx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const storekeeper = await createTestUser(prisma, { role: 'STOREKEEPER' });
    storekeeperCtx = { userId: storekeeper.userId, email: storekeeper.email, role: storekeeper.role, prisma };
    const owner = await createTestUser(prisma, { role: 'OWNER' });
    ownerCtx = { userId: owner.userId, email: owner.email, role: owner.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('create_purchase_order', () => {
    it('returns EMPTY_PO when lines is empty', async () => {
      const supplierName = `Purchasing Test Supplier ${randomUUID()}`;

      const result = await createPurchaseOrderTool.handler(storekeeperCtx, { supplierName, lines: [] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('EMPTY_PO');
    });

    it('returns MISSING_RATE when a line has no rate, and never silently substitutes a past rate', async () => {
      const material = await createMaterial(prisma);
      const supplierName = `Purchasing Test Supplier ${randomUUID()}`;
      const before = await prisma.purchaseOrder.count();

      const result = await createPurchaseOrderTool.handler(storekeeperCtx, {
        supplierName,
        lines: [{ materialId: material.id, quantity: 10 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('MISSING_RATE');

      // Nothing was created — a silent-reuse bug would still have produced a
      // PurchaseOrder row (at whatever rate it guessed).
      const after = await prisma.purchaseOrder.count();
      expect(after).toBe(before);
    });

    it('auto-approves (no Notification rows) when totalValue is at or below the configured threshold', async () => {
      await prisma.setting.upsert({
        where: { key: 'po.approval_threshold_inr' },
        create: { key: 'po.approval_threshold_inr', value: '100000', valueType: 'number' },
        update: { value: '100000' },
      });
      const material = await createMaterial(prisma);
      const supplier = await createSupplier(prisma, { name: `Purchasing Test Supplier ${randomUUID()}` });

      const result = await createPurchaseOrderTool.handler(storekeeperCtx, {
        supplierName: supplier.name,
        lines: [{ materialId: material.id, quantity: 10, rate: 100 }], // totalValue 1000, well under 100000
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const po = result.data as { id: string; status: string };
      expect(po.status).toBe('APPROVED');

      const notificationCount = await prisma.notification.count({ where: { entityId: po.id } });
      expect(notificationCount).toBe(0); // false-alarm check — no notification for an auto-approved PO
    });

    it('goes PENDING_APPROVAL and notifies every active OWNER when totalValue exceeds the threshold', async () => {
      await prisma.setting.upsert({
        where: { key: 'po.approval_threshold_inr' },
        create: { key: 'po.approval_threshold_inr', value: '500', valueType: 'number' },
        update: { value: '500' },
      });
      const owner = await createTestUser(prisma, { role: 'OWNER' });
      const material = await createMaterial(prisma);
      const supplier = await createSupplier(prisma, { name: `Purchasing Test Supplier ${randomUUID()}` });

      const result = await createPurchaseOrderTool.handler(storekeeperCtx, {
        supplierName: supplier.name,
        lines: [{ materialId: material.id, quantity: 10, rate: 100 }], // totalValue 1000 > 500
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const po = result.data as { id: string; status: string };
      expect(po.status).toBe('PENDING_APPROVAL');

      const notification = await prisma.notification.findFirst({ where: { entityId: po.id, userId: owner.userId } });
      expect(notification).not.toBeNull();
      expect(notification?.type).toBe('PO_PENDING_APPROVAL');
    });

    // The "prove atomicity, don't just assert the happy path" pattern
    // (mirroring audit-coverage.test.ts's own failure-path test): the
    // Notification insert happens inside the SAME withAuditedTransaction
    // callback as the PurchaseOrder create — if that insert fails, both
    // must roll back together, or a PENDING_APPROVAL PO could exist with
    // nobody ever notified. A plain jest.spyOn on prisma.notification.create
    // does NOT reach here — Prisma's interactive-transaction `tx` object is
    // a distinct binding, not a delegate to the top-level client (verified
    // empirically) — so this uses a $extends query override instead, which
    // (also verified empirically) DOES apply inside `tx`.
    it('rolls back the whole transaction — no orphan PENDING_APPROVAL PO — when the notification insert fails', async () => {
      await prisma.setting.upsert({
        where: { key: 'po.approval_threshold_inr' },
        create: { key: 'po.approval_threshold_inr', value: '0', valueType: 'number' },
        update: { value: '0' },
      });
      await createTestUser(prisma, { role: 'OWNER' }); // ensure at least one active OWNER exists to notify
      const material = await createMaterial(prisma);
      const supplier = await createSupplier(prisma, { name: `Purchasing Test Supplier ${randomUUID()}` });
      const supplierName = supplier.name;

      const failingPrisma = prisma.$extends({
        query: {
          notification: {
            async create() {
              throw new Error('SIMULATED_NOTIFICATION_INSERT_FAILURE');
            },
          },
        },
      }) as unknown as PrismaClient;
      const failingCtx: ToolContext = { ...storekeeperCtx, prisma: failingPrisma };

      const before = await prisma.purchaseOrder.count();

      const result = await createPurchaseOrderTool.handler(failingCtx, {
        supplierName,
        lines: [{ materialId: material.id, quantity: 10, rate: 100 }],
      });

      expect(result.ok).toBe(false);

      const after = await prisma.purchaseOrder.count();
      expect(after).toBe(before); // no orphan PO left behind
      // The supplier existed before the call and is untouched; purchase orders never create
      // parties any more, so there is nothing else that could be left behind.
      expect(await prisma.party.count({ where: { name: supplierName } })).toBe(1);
    });
  });

  describe('approve_purchase_order', () => {
    it('returns NOT_PENDING when the PO is not PENDING_APPROVAL', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'APPROVED' });

      const result = await approvePurchaseOrderTool.handler(ownerCtx, { purchaseOrderId: po.id });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_PENDING');
    });

    it('returns FORBIDDEN_NOT_OWNER for a non-owner caller (handler-level check, defense-in-depth below the router)', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });

      const result = await approvePurchaseOrderTool.handler(storekeeperCtx, { purchaseOrderId: po.id });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('approves a PENDING_APPROVAL PO for an OWNER caller', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });

      const result = await approvePurchaseOrderTool.handler(ownerCtx, { purchaseOrderId: po.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { status: string }).status).toBe('APPROVED');
    });
  });

  describe('reject_purchase_order', () => {
    it('returns FORBIDDEN_NOT_OWNER for a non-owner caller', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });

      const result = await rejectPurchaseOrderTool.handler(storekeeperCtx, { purchaseOrderId: po.id, reason: 'bad price' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('rejects a PENDING_APPROVAL PO and persists the reason so it reads back afterward', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
      const reason = `Price too high — vendor quoted above budget ${randomUUID()}`;

      const result = await rejectPurchaseOrderTool.handler(ownerCtx, { purchaseOrderId: po.id, reason });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { status: string }).status).toBe('REJECTED');

      const stored = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
      expect(stored.rejectionReason).toBe(reason); // not silently dropped
    });
  });

  describe('record_goods_receipt', () => {
    it('returns SPLIT_MISMATCH when acceptedQty + rejectedQty !== receivedQty', async () => {
      const supplier = await createSupplier(prisma);
      const material = await createMaterial(prisma);

      const result = await recordGoodsReceiptTool.handler(storekeeperCtx, {
        supplierId: supplier.id,
        receiptDate: new Date(),
        lines: [{ materialId: material.id, receivedQty: 10, acceptedQty: 5, rejectedQty: 0, rate: 5 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('SPLIT_MISMATCH');
    });

    it('returns MISSING_REJECTION_REASON when rejectedQty > 0 with no reason given', async () => {
      const supplier = await createSupplier(prisma);
      const material = await createMaterial(prisma);

      const result = await recordGoodsReceiptTool.handler(storekeeperCtx, {
        supplierId: supplier.id,
        receiptDate: new Date(),
        lines: [{ materialId: material.id, receivedQty: 10, acceptedQty: 7, rejectedQty: 3, rate: 5 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('MISSING_REJECTION_REASON');
    });

    it('returns PO_NOT_APPROVED by default against a PENDING_APPROVAL PO', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
      const material = po.lines[0].materialId;

      const result = await recordGoodsReceiptTool.handler(storekeeperCtx, {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        receiptDate: new Date(),
        lines: [{ materialId: material, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 100 }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PO_NOT_APPROVED');
    });

    // Regression harness: overrideConfirmed is a SEPARATE, STRONGER
    // confirmation than the router's generic `confirmed: true` gate (see
    // this tool's own description). If this in-handler check is ever
    // "simplified" to trust anything other than args.overrideConfirmed
    // being exactly `true` — e.g. defaulting to true, or getting merged
    // with the router's confirmed flag — this test starts passing when it
    // shouldn't (or, if the merge happens upstream, exercising this exact
    // handler-level invariant is what would first go stale and need
    // re-auditing). Omitting overrideConfirmed entirely must still block.
    it('overrideConfirmed omitted still returns PO_NOT_APPROVED against a PENDING_APPROVAL PO — the generic confirmed gate is not this guard', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
      const material = po.lines[0].materialId;

      const result = await recordGoodsReceiptTool.handler(storekeeperCtx, {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        receiptDate: new Date(),
        lines: [{ materialId: material, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 100 }],
        overrideConfirmed: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('PO_NOT_APPROVED');
    });

    it('succeeds against a PENDING_APPROVAL PO when overrideConfirmed: true is explicitly set', async () => {
      const po = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
      const material = po.lines[0].materialId;

      const result = await recordGoodsReceiptTool.handler(storekeeperCtx, {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        receiptDate: new Date(),
        lines: [{ materialId: material, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 100 }],
        overrideConfirmed: true,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('get_purchase_price_history', () => {
    it('returns rate history most-recent-first', async () => {
      const supplier = await createSupplier(prisma);
      const material = await createMaterial(prisma);
      const older = await prisma.goodsReceipt.create({
        data: { number: `GRN-HIST-${randomUUID()}`, supplierId: supplier.id, receiptDate: new Date('2026-01-01') },
      });
      await prisma.goodsReceiptLine.create({
        data: { goodsReceiptId: older.id, materialId: material.id, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 50, amount: 500 },
      });
      const newer = await prisma.goodsReceipt.create({
        data: { number: `GRN-HIST-${randomUUID()}`, supplierId: supplier.id, receiptDate: new Date('2026-06-01') },
      });
      await prisma.goodsReceiptLine.create({
        data: { goodsReceiptId: newer.id, materialId: material.id, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 75, amount: 750 },
      });

      const result = await getPurchasePriceHistoryTool.handler(storekeeperCtx, { materialId: material.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const history = result.data as { rate: unknown; receiptDate: Date }[];
      expect(history.length).toBeGreaterThanOrEqual(2);
      const dates = history.map((h) => new Date(h.receiptDate).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
    });
  });

  describe('list_pending_approvals', () => {
    it('returns purchase orders currently PENDING_APPROVAL', async () => {
      const pending = await createPurchaseOrder(prisma, { status: 'PENDING_APPROVAL' });
      await createPurchaseOrder(prisma, { status: 'APPROVED' });

      const result = await listPendingApprovalsTool.handler(storekeeperCtx, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = result.data as { id: string; status?: string }[];
      expect(rows.some((r) => r.id === pending.id)).toBe(true);
    });
  });
});
