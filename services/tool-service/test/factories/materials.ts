import { randomUUID } from 'node:crypto';
import type { Material, PrismaClient, StockType, Uom } from '@prisma/client';

export interface CreateMaterialOverrides {
  code?: string;
  name?: string;
  uom?: Uom;
  stockType?: StockType;
  minimumLevel?: number | null;
  hsnCode?: string | null;
  gstRate?: number | null;
  isScrap?: boolean;
  isActive?: boolean;
}

/**
 * A valid material master row. `name` is suffixed with a fresh UUID so
 * parallel tests never collide on create_material's own near-duplicate-name
 * suspicion check. Defaults to STANDING with minimumLevel: 10, since
 * STANDING requires a positive minimumLevel (mirrors create_material's own
 * handler-level rule, not just a DB constraint).
 */
export async function createMaterial(prisma: PrismaClient, overrides: CreateMaterialOverrides = {}): Promise<Material> {
  const suffix = randomUUID().slice(0, 8);
  const stockType = overrides.stockType ?? 'STANDING';
  const minimumLevel = overrides.minimumLevel !== undefined ? overrides.minimumLevel : stockType === 'STANDING' ? 10 : null;

  return prisma.material.create({
    data: {
      code: overrides.code ?? `MAT-TEST-${suffix}`,
      name: overrides.name ?? `Test Material ${suffix}`,
      uom: overrides.uom ?? 'KG',
      stockType,
      minimumLevel,
      hsnCode: overrides.hsnCode ?? undefined,
      gstRate: overrides.gstRate ?? undefined,
      isScrap: overrides.isScrap ?? false,
      isActive: overrides.isActive ?? true,
    },
  });
}
