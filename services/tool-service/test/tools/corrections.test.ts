import { randomUUID } from 'node:crypto';
import type { PrismaClient, StockMovement } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { createTestMovement } from '../infra/testMovement.js';
import { seedStockBalance } from '../infra/testStock.js';
import { createSupplier } from '../factories/parties.js';
import type { ToolContext } from '../../src/tools/types.js';
import reverseMovementTool from '../../src/tools/plugins/reverse_movement.js';
import recordGoodsReceiptTool from '../../src/tools/plugins/record_goods_receipt.js';

describe('reverse_movement (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ownerCtx: ToolContext;
  let storekeeperCtx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const owner = await createTestUser(prisma, { role: 'OWNER' });
    ownerCtx = { userId: owner.userId, email: owner.email, role: owner.role, prisma };
    const storekeeper = await createTestUser(prisma, { role: 'STOREKEEPER' });
    storekeeperCtx = { userId: storekeeper.userId, email: storekeeper.email, role: storekeeper.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('reverses a movement: opposite direction, same quantity/rate, type REVERSAL, reversalOfId set, original row completely unchanged, and the balance nets back exactly to its pre-original-movement state', async () => {
    const { material } = await createTestMaterial(prisma);
    // Baseline: RECEIPT 100 @ 10 -> qty 100, avg 10, value 1000.
    await seedStockBalance(prisma, { materialId: material.id, quantity: 100, averageRate: 10 });
    const preMovementBalance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });

    // The movement under test: an OUT movement (REJECT_RETURN doesn't
    // require a jobId, unlike ISSUE/RETURN) at the current average rate —
    // OUT never moves the average, matching how issue_material.ts stamps
    // rate: balance.averageRate on its own OUT movements.
    const original = await createTestMovement(prisma, {
      materialId: material.id,
      type: 'REJECT_RETURN',
      direction: 'OUT',
      quantity: 30,
      rate: 10,
    });
    const before = await prisma.stockMovement.findUniqueOrThrow({ where: { id: original.id } });

    const result = await reverseMovementTool.handler(ownerCtx, { movementId: original.id, reason: 'test reversal' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reversal = result.data as StockMovement;
    expect(reversal.direction).toBe('IN');
    expect(Number(reversal.quantity)).toBe(30);
    expect(Number(reversal.rate)).toBe(10);
    expect(reversal.type).toBe('REVERSAL');
    expect(reversal.reversalOfId).toBe(original.id);
    expect(reversal.materialId).toBe(original.materialId);
    expect(reversal.jobId).toBe(original.jobId);

    // The original row must be completely unchanged — reversal is purely
    // additive, never an edit (trg_block_movement_update backs this up at
    // the DB level, but the handler itself must never call update/delete).
    const after = await prisma.stockMovement.findUniqueOrThrow({ where: { id: original.id } });
    expect(after).toEqual(before);

    // The balance must net back exactly to its pre-original-movement state.
    const finalBalance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
    expect(Number(finalBalance.quantity)).toBe(Number(preMovementBalance.quantity));
    expect(Number(finalBalance.averageRate)).toBe(Number(preMovementBalance.averageRate));
    expect(Number(finalBalance.stockValue)).toBe(Number(preMovementBalance.stockValue));
  });

  it('reverses a movement seeded via record_goods_receipt directly, and the balance nets back to zero', async () => {
    const { material } = await createTestMaterial(prisma);
    const supplier = await createSupplier(prisma);

    const grnResult = await recordGoodsReceiptTool.handler(storekeeperCtx, {
      supplierId: supplier.id,
      receiptDate: new Date(),
      lines: [{ materialId: material.id, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rate: 5 }],
    });
    expect(grnResult.ok).toBe(true);
    if (!grnResult.ok) return;

    const receiptMovement = await prisma.stockMovement.findFirstOrThrow({
      where: { materialId: material.id, type: 'RECEIPT' },
    });

    const result = await reverseMovementTool.handler(ownerCtx, {
      movementId: receiptMovement.id,
      reason: 'undo goods receipt',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reversal = result.data as StockMovement;
    expect(reversal.direction).toBe('OUT');
    expect(Number(reversal.quantity)).toBe(10);
    expect(reversal.reversalOfId).toBe(receiptMovement.id);

    const finalBalance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
    expect(Number(finalBalance.quantity)).toBe(0);
    expect(Number(finalBalance.stockValue)).toBe(0);
  });

  it('reversing the same movement a second time fails with ALREADY_REVERSED and inserts no second reversal row', async () => {
    const original = await createTestMovement(prisma);

    const first = await reverseMovementTool.handler(ownerCtx, { movementId: original.id, reason: 'first reversal' });
    expect(first.ok).toBe(true);

    const beforeCount = await prisma.stockMovement.count({ where: { reversalOfId: original.id } });
    expect(beforeCount).toBe(1);

    const second = await reverseMovementTool.handler(ownerCtx, { movementId: original.id, reason: 'second reversal attempt' });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_REVERSED');

    const afterCount = await prisma.stockMovement.count({ where: { reversalOfId: original.id } });
    expect(afterCount).toBe(1);
  });

  it('a non-OWNER caller is rejected with FORBIDDEN_NOT_OWNER and nothing is inserted', async () => {
    const original = await createTestMovement(prisma);
    const before = await prisma.stockMovement.count();

    const result = await reverseMovementTool.handler(storekeeperCtx, { movementId: original.id, reason: 'not allowed' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN_NOT_OWNER');

    const after = await prisma.stockMovement.count();
    expect(after).toBe(before);
  });

  it('a nonexistent movementId returns MOVEMENT_NOT_FOUND', async () => {
    const result = await reverseMovementTool.handler(ownerCtx, { movementId: randomUUID(), reason: 'does not exist' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MOVEMENT_NOT_FOUND');
  });
});
