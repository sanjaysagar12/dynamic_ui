import type { PrismaClient } from '@prisma/client';
import type { CreateMaterialOverrides } from '../factories/materials.js';
import { createTestMaterial, type TestMaterial } from './testMaterial.js';

/**
 * Thin wrapper around createTestMaterial (which itself wraps the Phase 0
 * createMaterial factory) that forces isScrap: true, so scrap tests don't
 * have to repeat that override everywhere.
 */
export async function createTestScrapMaterial(
  prisma: PrismaClient,
  overrides: CreateMaterialOverrides = {},
): Promise<TestMaterial> {
  return createTestMaterial(prisma, { ...overrides, isScrap: true });
}
