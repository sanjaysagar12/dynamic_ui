import type { PrismaClient, StockMovement } from '@prisma/client';
import { withStock } from '../factories/stock.js';

export interface SeedStockBalanceOverrides {
  materialId: string;
  quantity: number;
  averageRate: number;
}

/**
 * Gets a material's StockBalance to a known starting point by posting a
 * single RECEIPT movement through Prisma (reusing the Phase 0 withStock
 * factory) rather than upserting stock_balances directly — per
 * inventory_guards.sql §9's own doc comment, stock_balances is DERIVED and
 * apply_stock_movement (the BEFORE INSERT trigger on stock_movements) is the
 * only path production code ever uses to change it, so a direct upsert here
 * would let a test seed a balance state real writes could never produce.
 *
 * Only valid for seeding a material still at its freshly-provisioned zero
 * balance: a single RECEIPT at rate R onto a zero balance always yields
 * averageRate === R exactly, since apply_stock_movement's weighted-average
 * formula (old_value + qty*rate) / new_qty degenerates to plain `rate` when
 * old_value/old_qty are both 0 — confirmed by Layer 1's
 * 1.2-weighted-average.test.ts, step 1.
 */
export async function seedStockBalance(prisma: PrismaClient, overrides: SeedStockBalanceOverrides): Promise<StockMovement> {
  return withStock(prisma, overrides.materialId, overrides.quantity, overrides.averageRate);
}
