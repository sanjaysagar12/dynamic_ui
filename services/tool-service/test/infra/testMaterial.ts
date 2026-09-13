import type { Material, PrismaClient, StockBalance } from '@prisma/client';
import { createMaterial, type CreateMaterialOverrides } from '../factories/materials.js';

export interface TestMaterial {
  material: Material;
  balance: StockBalance;
}

/**
 * createMaterial (Phase 0's factory) already relies on trg_create_balance_row
 * auto-provisioning a StockBalance at insert time — this just also fetches
 * that row, for Layer 2 tests that want both without repeating the lookup.
 */
export async function createTestMaterial(prisma: PrismaClient, overrides: CreateMaterialOverrides = {}): Promise<TestMaterial> {
  const material = await createMaterial(prisma, overrides);
  const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
  return { material, balance };
}
