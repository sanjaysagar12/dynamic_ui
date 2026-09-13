import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { seedStockBalance } from '../infra/testStock.js';
import { assertBalanceIntegrityClean } from '../infra/assertions.js';
import { createStockCount } from '../factories/stockCounts.js';
import type { ToolContext } from '../../src/tools/types.js';
import startStockCountTool from '../../src/tools/plugins/start_stock_count.js';
import submitCountLineTool from '../../src/tools/plugins/submit_count_line.js';
import submitStockCountTool from '../../src/tools/plugins/submit_stock_count.js';
import approveStockCountTool from '../../src/tools/plugins/approve_stock_count.js';
import rejectStockCountTool from '../../src/tools/plugins/reject_stock_count.js';

describe('physical stock count tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext; // STOREKEEPER — start/submit tools carry no requiredRoles
  let ownerCtx: ToolContext; // OWNER — approve/reject are owner-only
  let ownerUserId: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const storekeeper = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: storekeeper.userId, email: storekeeper.email, role: storekeeper.role, prisma };
    // Exactly ONE active OWNER for the whole file — submit_stock_count/
    // reject_stock_count notify every active OWNER, and this file's tests
    // share one un-rolled-back database, so keeping the owner count fixed
    // at 1 is what makes "exactly one Notification row" a stable assertion
    // below (same convention as issue-return.test.ts).
    const owner = await createTestUser(prisma, { role: 'OWNER' });
    ownerUserId = owner.userId;
    ownerCtx = { userId: owner.userId, email: owner.email, role: owner.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('start_stock_count', () => {
    it("creates a DRAFT count and one line per active material, with systemQty frozen to each material's current balance", async () => {
      const { material: m1 } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: m1.id, quantity: 42, averageRate: 3 });
      const { material: m2 } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: m2.id, quantity: 17, averageRate: 2 });

      // Measured immediately before the call — other tests/files leave
      // active materials behind, so this is a relative check, not a
      // hardcoded count.
      const activeMaterialCount = await prisma.material.count({ where: { isActive: true } });

      const result = await startStockCountTool.handler(ctx, { countDate: new Date() });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { status: string; lines: { materialId: string; systemQty: unknown }[] };
      expect(data.status).toBe('DRAFT');
      expect(data.lines.length).toBe(activeMaterialCount);

      const byMaterial = new Map(data.lines.map((l) => [l.materialId, Number(l.systemQty)]));
      expect(byMaterial.get(m1.id)).toBe(42);
      expect(byMaterial.get(m2.id)).toBe(17);
    });

    it('with materialIds given, only those materials get lines', async () => {
      const { material: m1 } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: m1.id, quantity: 5, averageRate: 1 });
      await createTestMaterial(prisma); // deliberately not included

      const result = await startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [m1.id] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { lines: { materialId: string; systemQty: unknown }[] };
      expect(data.lines.length).toBe(1);
      expect(data.lines[0].materialId).toBe(m1.id);
      expect(Number(data.lines[0].systemQty)).toBe(5);
    });

    it('concurrency: a stock movement racing start_stock_count never produces a torn read of systemQty', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 100, averageRate: 5 });

      const [countResult] = await Promise.all([
        startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [material.id] }),
        prisma.stockMovement.create({
          data: {
            materialId: material.id,
            type: 'RECEIPT',
            direction: 'IN',
            quantity: 50,
            rate: 5,
            value: 0,
            balanceQtyAfter: 0,
            balanceRateAfter: 0,
            balanceValueAfter: 0,
            movementDate: new Date(),
          },
        }),
      ]);

      expect(countResult.ok).toBe(true);
      if (!countResult.ok) return;
      const lines = (countResult.data as { lines: { materialId: string; systemQty: unknown }[] }).lines;
      const line = lines.find((l) => l.materialId === material.id);
      expect(line).toBeDefined();
      // The frozen systemQty must reflect one consistent instant — either
      // fully before or fully after the concurrent RECEIPT — never a
      // torn/partial value.
      expect([100, 150]).toContain(Number(line?.systemQty));

      await assertBalanceIntegrityClean(prisma);
    });
  });

  describe('submit_count_line', () => {
    it('computes differenceQty as countedQty - systemQty and stores the given reasonCode', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 100, averageRate: 5 });
      const started = await startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [material.id] });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const line = (started.data as { lines: { id: string }[] }).lines[0];

      const result = await submitCountLineTool.handler(ctx, {
        stockCountLineId: line.id,
        countedQty: 90,
        reasonCode: 'SPILLAGE',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const updated = result.data as { differenceQty: unknown; reasonCode: string | null; countedQty: unknown };
      expect(Number(updated.countedQty)).toBe(90);
      expect(Number(updated.differenceQty)).toBe(-10);
      expect(updated.reasonCode).toBe('SPILLAGE');
    });

    it('a nonzero difference with reasonCode omitted stores UNEXPLAINED — no retry/re-ask', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 50, averageRate: 5 });
      const started = await startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [material.id] });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const line = (started.data as { lines: { id: string }[] }).lines[0];

      const result = await submitCountLineTool.handler(ctx, { stockCountLineId: line.id, countedQty: 55 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const updated = result.data as { reasonCode: string | null };
      expect(updated.reasonCode).toBe('UNEXPLAINED');
    });

    it('a zero difference with reasonCode omitted leaves reasonCode unset', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 50, averageRate: 5 });
      const started = await startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [material.id] });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const line = (started.data as { lines: { id: string }[] }).lines[0];

      const result = await submitCountLineTool.handler(ctx, { stockCountLineId: line.id, countedQty: 50 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const updated = result.data as { differenceQty: unknown; reasonCode: string | null };
      expect(Number(updated.differenceQty)).toBe(0);
      expect(updated.reasonCode).toBeNull();
    });

    it('rejects with NOT_DRAFT when the parent count is not DRAFT', async () => {
      const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL', lines: [{ countedQty: null }] });
      const line = count.lines[0];

      const result = await submitCountLineTool.handler(ctx, { stockCountLineId: line.id, countedQty: 5 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_DRAFT');
    });
  });

  describe('submit_stock_count', () => {
    it('rejects with INCOMPLETE_COUNT when any line has no countedQty recorded', async () => {
      const { material: m1 } = await createTestMaterial(prisma);
      const { material: m2 } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: m1.id, quantity: 10, averageRate: 1 });
      await seedStockBalance(prisma, { materialId: m2.id, quantity: 10, averageRate: 1 });

      const started = await startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [m1.id, m2.id] });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const data = started.data as { id: string; lines: { id: string; materialId: string }[] };
      const lineForM1 = data.lines.find((l) => l.materialId === m1.id)!;
      await submitCountLineTool.handler(ctx, { stockCountLineId: lineForM1.id, countedQty: 10 });
      // m2's line is deliberately left uncounted.

      const result = await submitStockCountTool.handler(ctx, { stockCountId: data.id });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('INCOMPLETE_COUNT');
    });

    it('a successful submission flips to PENDING_APPROVAL and produces exactly one Notification with a correct variance summary', async () => {
      const { material: matched } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: matched.id, quantity: 50, averageRate: 4 });
      const { material: diff } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: diff.id, quantity: 50, averageRate: 4 });

      const started = await startStockCountTool.handler(ctx, {
        countDate: new Date(),
        materialIds: [matched.id, diff.id],
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const data = started.data as { id: string; lines: { id: string; materialId: string }[] };
      const matchedLine = data.lines.find((l) => l.materialId === matched.id)!;
      const diffLine = data.lines.find((l) => l.materialId === diff.id)!;

      await submitCountLineTool.handler(ctx, { stockCountLineId: matchedLine.id, countedQty: 50 }); // diff 0
      await submitCountLineTool.handler(ctx, { stockCountLineId: diffLine.id, countedQty: 60 }); // diff +10 @ rate 4 = 40

      const before = await prisma.notification.count({ where: { entityId: data.id, type: 'COUNT_PENDING_APPROVAL' } });
      expect(before).toBe(0);

      const result = await submitStockCountTool.handler(ctx, { stockCountId: data.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const outcome = result.data as {
        materialsWithDifference: number;
        totalVarianceValue: number;
        count: { status: string };
      };
      expect(outcome.materialsWithDifference).toBe(1);
      expect(outcome.totalVarianceValue).toBeCloseTo(40, 4);
      expect(outcome.count.status).toBe('PENDING_APPROVAL');

      const after = await prisma.notification.count({ where: { entityId: data.id, type: 'COUNT_PENDING_APPROVAL' } });
      expect(after).toBe(1);

      const notification = await prisma.notification.findFirstOrThrow({
        where: { entityId: data.id, type: 'COUNT_PENDING_APPROVAL' },
      });
      expect(notification.userId).toBe(ownerUserId);
      expect(notification.body).toContain('1 material');
      expect(notification.body).toContain('40.00');
    });
  });

  describe('approve_stock_count', () => {
    it('rejects with FORBIDDEN_NOT_OWNER for a non-owner caller', async () => {
      const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

      const result = await approveStockCountTool.handler(ctx, { stockCountId: count.id });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('rejects with NOT_PENDING for a count not in PENDING_APPROVAL', async () => {
      const count = await createStockCount(prisma, { status: 'DRAFT' });

      const result = await approveStockCountTool.handler(ownerCtx, { stockCountId: count.id });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_PENDING');
    });

    // THE ORDERING REGRESSION TEST — the most important test in this batch.
    // Exercises the real handler; does not hand-roll a second "wrong order"
    // handler. trg_guard_count_adjustment's own rejection of the wrong
    // order is proven directly by test/db/1.5-count-adjustment-guard.test.ts
    // (Layer 1). This test's job is to confirm approve_stock_count's actual
    // code path — status flip, THEN movements — produces zero orphaned/
    // rejected movements and a clean APPROVED status when run normally,
    // with mixed positive/negative differences handled correctly and
    // zero-difference lines posting nothing.
    it('approves cleanly: status flips before movements post, mixed directions are correct, zero-difference lines post nothing, balance equals counted qty exactly per line', async () => {
      const { material: matIn } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: matIn.id, quantity: 100, averageRate: 5 });
      const { material: matOut } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: matOut.id, quantity: 100, averageRate: 5 });
      const { material: matSame } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: matSame.id, quantity: 100, averageRate: 5 });

      const count = await createStockCount(prisma, {
        status: 'PENDING_APPROVAL',
        lines: [
          { materialId: matIn.id, systemQty: 100, countedQty: 120 }, // +20 -> IN
          { materialId: matOut.id, systemQty: 100, countedQty: 70 }, // -30 -> OUT
          { materialId: matSame.id, systemQty: 100, countedQty: 100 }, // 0 -> no movement
        ],
      });

      const result = await approveStockCountTool.handler(ownerCtx, { stockCountId: count.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const outcome = result.data as {
        count: { status: string };
        movements: { materialId: string; direction: string; quantity: unknown }[];
      };
      expect(outcome.count.status).toBe('APPROVED');
      // Exactly the two non-zero-difference lines — no orphaned/extra rows.
      expect(outcome.movements.length).toBe(2);

      const inMovement = outcome.movements.find((m) => m.materialId === matIn.id);
      expect(inMovement?.direction).toBe('IN');
      expect(Number(inMovement?.quantity)).toBe(20);

      const outMovement = outcome.movements.find((m) => m.materialId === matOut.id);
      expect(outMovement?.direction).toBe('OUT');
      expect(Number(outMovement?.quantity)).toBe(30);

      expect(outcome.movements.some((m) => m.materialId === matSame.id)).toBe(false);

      const persistedCount = await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } });
      expect(persistedCount.status).toBe('APPROVED');

      const balanceIn = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: matIn.id } });
      expect(Number(balanceIn.quantity)).toBe(120);
      const balanceOut = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: matOut.id } });
      expect(Number(balanceOut.quantity)).toBe(70);
      const balanceSame = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: matSame.id } });
      expect(Number(balanceSame.quantity)).toBe(100);

      await assertBalanceIntegrityClean(prisma);
    });
  });

  describe('reject_stock_count', () => {
    it('rejects with FORBIDDEN_NOT_OWNER for a non-owner caller', async () => {
      const count = await createStockCount(prisma, { status: 'PENDING_APPROVAL' });

      const result = await rejectStockCountTool.handler(ctx, { stockCountId: count.id, rejectionNote: 'x' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('rejects with NOT_PENDING for a count not in PENDING_APPROVAL', async () => {
      const count = await createStockCount(prisma, { status: 'DRAFT' });

      const result = await rejectStockCountTool.handler(ownerCtx, { stockCountId: count.id, rejectionNote: 'x' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_PENDING');
    });

    it('a rejected count: REJECTED status, rejectionNote persisted, zero movements posted, balance unchanged, RECOUNT_REQUIRED notification created', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 80, averageRate: 2 });
      const count = await createStockCount(prisma, {
        status: 'PENDING_APPROVAL',
        lines: [{ materialId: material.id, systemQty: 80, countedQty: 60 }], // diff -20
      });

      const before = await prisma.notification.count({ where: { entityId: count.id, type: 'RECOUNT_REQUIRED' } });
      expect(before).toBe(0);

      const result = await rejectStockCountTool.handler(ownerCtx, {
        stockCountId: count.id,
        rejectionNote: 'Recount the whole aisle',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const updated = result.data as { status: string; rejectionNote: string | null };
      expect(updated.status).toBe('REJECTED');
      expect(updated.rejectionNote).toBe('Recount the whole aisle');

      const movementCount = await prisma.stockMovement.count({ where: { stockCountLineId: count.lines[0].id } });
      expect(movementCount).toBe(0);

      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(Number(balance.quantity)).toBe(80);

      const after = await prisma.notification.count({ where: { entityId: count.id, type: 'RECOUNT_REQUIRED' } });
      expect(after).toBe(1);

      await assertBalanceIntegrityClean(prisma);
    });
  });

  describe('full lifecycle (every tool called in sequence, not seeded via factory shortcuts)', () => {
    it('start -> submit mixed matching/differing/unexplained lines -> submit count -> approve as owner: balances equal counted qty exactly per line, exactly one AuditEvent per mutating call', async () => {
      const { material: matching } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: matching.id, quantity: 30, averageRate: 3 });
      const { material: differing } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: differing.id, quantity: 30, averageRate: 3 });
      const { material: unexplained } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: unexplained.id, quantity: 30, averageRate: 3 });

      const auditBefore = await prisma.auditEvent.count();

      const started = await startStockCountTool.handler(ctx, {
        countDate: new Date(),
        materialIds: [matching.id, differing.id, unexplained.id],
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const data = started.data as { id: string; lines: { id: string; materialId: string }[] };
      const lineFor = (materialId: string) => data.lines.find((l) => l.materialId === materialId)!;

      const submitMatching = await submitCountLineTool.handler(ctx, {
        stockCountLineId: lineFor(matching.id).id,
        countedQty: 30, // matches system qty exactly
      });
      expect(submitMatching.ok).toBe(true);

      const submitDiffering = await submitCountLineTool.handler(ctx, {
        stockCountLineId: lineFor(differing.id).id,
        countedQty: 45,
        reasonCode: 'EXTRA_WASTAGE',
      });
      expect(submitDiffering.ok).toBe(true);

      const submitUnexplained = await submitCountLineTool.handler(ctx, {
        stockCountLineId: lineFor(unexplained.id).id,
        countedQty: 20, // reasonCode omitted -> UNEXPLAINED
      });
      expect(submitUnexplained.ok).toBe(true);
      if (!submitUnexplained.ok) return;
      expect((submitUnexplained.data as { reasonCode: string | null }).reasonCode).toBe('UNEXPLAINED');

      const submitted = await submitStockCountTool.handler(ctx, { stockCountId: data.id });
      expect(submitted.ok).toBe(true);

      const approved = await approveStockCountTool.handler(ownerCtx, { stockCountId: data.id });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      const outcome = approved.data as { movements: { materialId: string }[] };
      // The matching line contributes no movement — only the two
      // differing/unexplained lines do.
      expect(outcome.movements.length).toBe(2);
      expect(outcome.movements.some((m) => m.materialId === matching.id)).toBe(false);

      const balanceMatching = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: matching.id } });
      expect(Number(balanceMatching.quantity)).toBe(30);
      const balanceDiffering = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: differing.id } });
      expect(Number(balanceDiffering.quantity)).toBe(45);
      const balanceUnexplained = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: unexplained.id } });
      expect(Number(balanceUnexplained.quantity)).toBe(20);

      // Exactly one AuditEvent per mutating call in this chain: start (1) +
      // submit_count_line x3 (3) + submit_stock_count (1) + approve_stock_count
      // (1) = 6.
      const auditAfter = await prisma.auditEvent.count();
      expect(auditAfter - auditBefore).toBe(6);

      await assertBalanceIntegrityClean(prisma);
    });

    it('start -> submit -> submit count -> reject as owner: zero movements, RECOUNT_REQUIRED notification exists, balances unchanged', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 25, averageRate: 6 });

      const started = await startStockCountTool.handler(ctx, { countDate: new Date(), materialIds: [material.id] });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const data = started.data as { id: string; lines: { id: string }[] };

      await submitCountLineTool.handler(ctx, { stockCountLineId: data.lines[0].id, countedQty: 18 }); // diff -7

      const submitted = await submitStockCountTool.handler(ctx, { stockCountId: data.id });
      expect(submitted.ok).toBe(true);

      const rejected = await rejectStockCountTool.handler(ownerCtx, {
        stockCountId: data.id,
        rejectionNote: 'Recount this aisle',
      });
      expect(rejected.ok).toBe(true);
      if (!rejected.ok) return;
      expect((rejected.data as { status: string }).status).toBe('REJECTED');

      const movementCount = await prisma.stockMovement.count({ where: { stockCountLineId: data.lines[0].id } });
      expect(movementCount).toBe(0);

      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(Number(balance.quantity)).toBe(25);

      const notificationCount = await prisma.notification.count({ where: { entityId: data.id, type: 'RECOUNT_REQUIRED' } });
      expect(notificationCount).toBe(1);

      await assertBalanceIntegrityClean(prisma);
    });
  });
});
