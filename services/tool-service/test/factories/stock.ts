import type { PrismaClient, StockMovement } from '@prisma/client';

/**
 * Gets a material to a specific starting balance by posting a real RECEIPT
 * movement through Prisma — not by writing stock_balances directly — so
 * tests that need a material at a precise non-zero starting quantity/rate
 * (Layer 1's weighted-average tests) exercise the same trigger-driven
 * (apply_stock_movement) code path production writes go through.
 */
export async function withStock(
  prisma: PrismaClient,
  materialId: string,
  quantity: number,
  rate: number,
): Promise<StockMovement> {
  return prisma.stockMovement.create({
    data: {
      materialId,
      type: 'RECEIPT',
      direction: 'IN',
      quantity,
      rate,
      // value/balanceQtyAfter/balanceRateAfter/balanceValueAfter are
      // required, non-defaulted columns on the Prisma model, but the
      // BEFORE INSERT apply_stock_movement trigger overwrites all four
      // before the row is actually stored — these placeholders are never
      // what ends up on disk.
      value: 0,
      balanceQtyAfter: 0,
      balanceRateAfter: 0,
      balanceValueAfter: 0,
      movementDate: new Date(),
    },
  });
}
