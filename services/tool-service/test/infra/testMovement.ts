import type { PrismaClient, StockMovement, MovementType, MovementDirection } from '@prisma/client';
import { createTestMaterial } from './testMaterial.js';

export interface CreateTestMovementOverrides {
  materialId?: string;
  type?: MovementType;
  direction?: MovementDirection;
  quantity?: number;
  rate?: number;
  jobId?: string;
}

/**
 * Inserts one StockMovement row directly via Prisma — bypassing the tool
 * layer entirely, since this is test setup for Batch G (reverse_movement),
 * not the behavior under test. Defaults to a RECEIPT/IN movement against a
 * freshly created material (via createTestMaterial, which relies on
 * trg_create_balance_row auto-provisioning the StockBalance row), the same
 * "post a real movement through the trigger-driven path" convention as
 * factories/stock.ts's withStock — a direct stock_balances write would let a
 * test seed a state real writes could never produce.
 */
export async function createTestMovement(
  prisma: PrismaClient,
  overrides: CreateTestMovementOverrides = {},
): Promise<StockMovement> {
  const materialId = overrides.materialId ?? (await createTestMaterial(prisma)).material.id;

  return prisma.stockMovement.create({
    data: {
      materialId,
      type: overrides.type ?? 'RECEIPT',
      direction: overrides.direction ?? 'IN',
      quantity: overrides.quantity ?? 10,
      rate: overrides.rate ?? 5,
      // value/balance*After are stamped by the trg_apply_stock_movement
      // BEFORE INSERT trigger — these placeholders are overwritten
      // regardless of what's passed here (same convention as
      // factories/stock.ts's withStock).
      value: 0,
      balanceQtyAfter: 0,
      balanceRateAfter: 0,
      balanceValueAfter: 0,
      jobId: overrides.jobId,
      movementDate: new Date(),
    },
  });
}
