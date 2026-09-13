import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { createTestJob, createTestJobBomLine } from '../infra/testJob.js';
import { seedStockBalance } from '../infra/testStock.js';
import type { ToolContext } from '../../src/tools/types.js';
import issueMaterialTool from '../../src/tools/plugins/issue_material.js';
import returnMaterialTool from '../../src/tools/plugins/return_material.js';
import closeJobTool from '../../src/tools/plugins/close_job.js';
import getMovementHistoryTool from '../../src/tools/plugins/get_movement_history.js';

describe('issue/return/close job tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const user = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: user.userId, email: user.email, role: user.role, prisma };
    // Exactly ONE active OWNER exists for the whole file — issue_material's
    // negative-stock path notifies every active OWNER, and this file's tests
    // don't run inside a per-test rolled-back transaction (README.md), so
    // keeping the owner count fixed at 1 for the whole file is what makes
    // "exactly one Notification row" a meaningful, stable assertion below.
    await createTestUser(prisma, { role: 'OWNER' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('issue_material', () => {
    it('issues against a job with sufficient stock; JobBomLine.issuedQty updates and Job.status flips to MATERIAL_ISSUED on the first issue', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 10 });
      const job = await createTestJob(prisma);
      const bomLine = await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 2 });

      const result = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 50 }] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const updatedBom = await prisma.jobBomLine.findUniqueOrThrow({ where: { id: bomLine.id } });
      expect(Number(updatedBom.issuedQty)).toBe(50);

      const updatedJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(updatedJob.status).toBe('MATERIAL_ISSUED');
    });

    it('a second issue on the same job (already MATERIAL_ISSUED) succeeds without re-flipping status incorrectly', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 10 });
      const job = await createTestJob(prisma);
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 2 });

      const first = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 50 }] });
      expect(first.ok).toBe(true);

      const second = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 30 }] });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect((second.data as { jobStatus: string }).jobStatus).toBe('MATERIAL_ISSUED');

      const updatedJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(updatedJob.status).toBe('MATERIAL_ISSUED');
    });

    it('omitted lines issues exactly the full outstanding BOM requirement per material', async () => {
      const { material: m1 } = await createTestMaterial(prisma);
      const { material: m2 } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: m1.id, quantity: 1000, averageRate: 5 });
      await seedStockBalance(prisma, { materialId: m2.id, quantity: 1000, averageRate: 5 });
      const job = await createTestJob(prisma, { quantity: 10 });
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: m1.id, qtyPerPiece: 3 }); // requiredQty = 30
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: m2.id, qtyPerPiece: 5 }); // requiredQty = 50

      const result = await issueMaterialTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const movements = (result.data as { movements: { materialId: string; quantity: unknown }[] }).movements;
      const byMaterial = new Map(movements.map((m) => [m.materialId, Number(m.quantity)]));
      expect(byMaterial.get(m1.id)).toBe(30);
      expect(byMaterial.get(m2.id)).toBe(50);
    });

    it('issuing again with no lines after a full issue issues zero additional quantity — no new movement row', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 5 });
      const job = await createTestJob(prisma, { quantity: 10 });
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 2 }); // requiredQty = 20

      const first = await issueMaterialTool.handler(ctx, { jobId: job.id });
      expect(first.ok).toBe(true);

      const before = await prisma.stockMovement.count({ where: { jobId: job.id, type: 'ISSUE' } });
      const second = await issueMaterialTool.handler(ctx, { jobId: job.id });

      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect((second.data as { movements: unknown[] }).movements).toEqual([]);

      const after = await prisma.stockMovement.count({ where: { jobId: job.id, type: 'ISSUE' } });
      expect(after).toBe(before);
    });

    it('an explicit quantity beyond the outstanding BOM requirement tags the resulting movement as a top-up', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 5 });
      const job = await createTestJob(prisma, { quantity: 10 });
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 2 }); // requiredQty = 20

      const result = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 25 }] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const movement = (result.data as { movements: { notes: string | null }[] }).movements[0];
      expect(movement.notes).toBe('rework top-up');
    });

    it('issuing beyond available stock succeeds, balance goes negative, a warning is attached, and exactly one Notification row is inserted', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 10, averageRate: 5 });
      const job = await createTestJob(prisma);

      const before = await prisma.notification.count({ where: { type: 'NEGATIVE_STOCK_WARNING' } });

      const result = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 50 }] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { warning?: string }).warning).toBeDefined();

      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(Number(balance.quantity)).toBe(-40);

      const after = await prisma.notification.count({ where: { type: 'NEGATIVE_STOCK_WARNING' } });
      expect(after).toBe(before + 1);
    });

    it('issuing with sufficient stock raises no warning and inserts no Notification row', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 5 });
      const job = await createTestJob(prisma);

      const before = await prisma.notification.count({ where: { type: 'NEGATIVE_STOCK_WARNING' } });

      const result = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 10 }] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { warning?: string }).warning).toBeUndefined();

      const after = await prisma.notification.count({ where: { type: 'NEGATIVE_STOCK_WARNING' } });
      expect(after).toBe(before);
    });

    it('a job in CLOSED status returns JOB_NOT_ISSUABLE', async () => {
      const job = await createTestJob(prisma);
      await prisma.job.update({ where: { id: job.id }, data: { status: 'CLOSED' } });
      const { material } = await createTestMaterial(prisma);

      const result = await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 1 }] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('JOB_NOT_ISSUABLE');
    });

    // FORBIDDEN_ROLE (the handler's own belt-and-suspenders check) is left
    // unexercised here deliberately: @org/shared-types's ROLES is exhaustively
    // ['OWNER', 'STOREKEEPER'] (ARCHITECTURE.md §1), and issue_material's own
    // requiredRoles is exactly that pair, so there is no constructible User
    // (the Postgres UserRole enum only has those two values) whose role would
    // ever reach this branch — same "untestable as written, flagged rather
    // than forced" note as reject_purchase_order's own handler-level check.
  });

  describe('return_material', () => {
    it('a successful return updates JobBomLine.returnedQty, and the movement rate is the balance averageRate at call time — a caller-supplied rate is ignored', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 7 });
      const job = await createTestJob(prisma);
      const bomLine = await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 5 });
      await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 50 }] });

      // return_material's own inputSchema has no `rate` field at all — cast
      // past that with `as never` to prove a smuggled-in value is still
      // structurally ignored, not just rejected by validation.
      const result = await returnMaterialTool.handler(ctx, {
        jobId: job.id,
        lines: [{ materialId: material.id, quantity: 10, rate: 999 } as never],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const movement = (result.data as { movements: { rate: unknown }[] }).movements[0];
      // ISSUE never moves the average (inventory_guards.sql §9), so the
      // balance's averageRate is still exactly the seeded 7 at return time.
      expect(Number(movement.rate)).toBe(7);
      expect(Number(movement.rate)).not.toBe(999);

      const updatedBom = await prisma.jobBomLine.findUniqueOrThrow({ where: { id: bomLine.id } });
      expect(Number(updatedBom.returnedQty)).toBe(10);
    });

    it('a return for a material never issued to that job returns NOTHING_ISSUED_FOR_MATERIAL', async () => {
      const { material } = await createTestMaterial(prisma);
      const job = await createTestJob(prisma);

      const result = await returnMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 5 }] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOTHING_ISSUED_FOR_MATERIAL');
    });
  });

  describe('close_job', () => {
    it('full happy path (issue -> partial return -> close): materialCost matches hand-computed issue-minus-return value, status -> CLOSED, closedAt set', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 10 });
      const job = await createTestJob(prisma);
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 5 });

      // ISSUE 50 @ averageRate 10 (an OUT movement never moves the average)
      //   issue value = 50 * 10 = 500
      await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 50 }] });
      // RETURN 20 @ averageRate 10 (still 10 — the ISSUE above didn't touch it,
      // and a RETURN itself never distorts the average either)
      //   return value = 20 * 10 = 200
      await returnMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: material.id, quantity: 20 }] });

      const result = await closeJobTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { job: { materialCost: unknown; status: string; closedAt: unknown } };
      // hand-computed: materialCost = issued_value - returned_value = 500 - 200 = 300
      expect(Number(data.job.materialCost)).toBe(300);
      expect(data.job.status).toBe('CLOSED');
      expect(data.job.closedAt).not.toBeNull();
    });

    it('a job closed with a large outstanding issued-not-returned quantity always carries the outstanding summary (no threshold applied)', async () => {
      const { material } = await createTestMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 1000, averageRate: 10 });
      const job = await createTestJob(prisma, { quantity: 10 });
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: material.id, qtyPerPiece: 5 }); // requiredQty = 50

      // Issue the full outstanding (50) and return nothing — outstanding stays at 50.
      await issueMaterialTool.handler(ctx, { jobId: job.id });

      const result = await closeJobTool.handler(ctx, { jobId: job.id });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const outstanding = (result.data as { outstanding: { materialId: string; outstandingQty: number }[] }).outstanding;
      const line = outstanding.find((o) => o.materialId === material.id);
      expect(line).toBeDefined();
      expect(line?.outstandingQty).toBe(50);
    });
  });

  describe('get_movement_history', () => {
    it('filtered by materialId and separately by jobId, each returning only the expected rows', async () => {
      const { material: m1 } = await createTestMaterial(prisma);
      const { material: m2 } = await createTestMaterial(prisma);
      const job = await createTestJob(prisma);
      await createTestJobBomLine(prisma, { jobId: job.id, materialId: m1.id, qtyPerPiece: 1 });

      await seedStockBalance(prisma, { materialId: m1.id, quantity: 100, averageRate: 5 }); // RECEIPT, no job, m1
      await seedStockBalance(prisma, { materialId: m2.id, quantity: 100, averageRate: 5 }); // RECEIPT, no job, m2
      await issueMaterialTool.handler(ctx, { jobId: job.id, lines: [{ materialId: m1.id, quantity: 10 }] }); // ISSUE, job + m1

      const byMaterial = await getMovementHistoryTool.handler(ctx, { materialId: m1.id });
      expect(byMaterial.ok).toBe(true);
      if (!byMaterial.ok) return;
      const materialMovements = (byMaterial.data as { movements: { materialId: string }[] }).movements;
      expect(materialMovements.length).toBe(2);
      expect(materialMovements.every((m) => m.materialId === m1.id)).toBe(true);

      const byJob = await getMovementHistoryTool.handler(ctx, { jobId: job.id });
      expect(byJob.ok).toBe(true);
      if (!byJob.ok) return;
      const jobMovements = (byJob.data as { movements: { jobId: string | null }[] }).movements;
      expect(jobMovements.length).toBe(1);
      expect(jobMovements[0].jobId).toBe(job.id);
    });

    it('cursor/take pagination returns a stable, non-overlapping second page in descending date order', async () => {
      const { material } = await createTestMaterial(prisma);
      const baseDate = new Date('2026-01-01T00:00:00Z');
      const DAY_MS = 24 * 60 * 60 * 1000;

      const movementIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const created = await prisma.stockMovement.create({
          data: {
            materialId: material.id,
            type: 'RECEIPT',
            direction: 'IN',
            quantity: 1,
            rate: 1,
            value: 0,
            balanceQtyAfter: 0,
            balanceRateAfter: 0,
            balanceValueAfter: 0,
            movementDate: new Date(baseDate.getTime() + i * DAY_MS),
          },
        });
        movementIds.push(created.id);
      }
      // Newest movementDate first.
      const expectedOrder = [...movementIds].reverse();

      const page1 = await getMovementHistoryTool.handler(ctx, { materialId: material.id, take: 2 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      const page1Data = page1.data as { movements: { id: string }[]; nextCursor: string | null };
      expect(page1Data.movements.map((m) => m.id)).toEqual(expectedOrder.slice(0, 2));
      expect(page1Data.nextCursor).toBe(expectedOrder[1]);

      const page2 = await getMovementHistoryTool.handler(ctx, {
        materialId: material.id,
        take: 2,
        cursor: page1Data.nextCursor!,
      });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      const page2Data = page2.data as { movements: { id: string }[]; nextCursor: string | null };
      expect(page2Data.movements.map((m) => m.id)).toEqual(expectedOrder.slice(2, 4));

      const page1Ids = new Set(page1Data.movements.map((m) => m.id));
      for (const m of page2Data.movements) {
        expect(page1Ids.has(m.id)).toBe(false);
      }
    });
  });
});
