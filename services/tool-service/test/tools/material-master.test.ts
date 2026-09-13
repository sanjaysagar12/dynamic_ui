import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { withStock } from '../factories/stock.js';
import type { ToolContext } from '../../src/tools/types.js';
import createMaterialTool from '../../src/tools/plugins/create_material.js';
import updateMaterialTool from '../../src/tools/plugins/update_material.js';
import deactivateMaterialTool from '../../src/tools/plugins/deactivate_material.js';
import getMaterialBalanceTool from '../../src/tools/plugins/get_material_balance.js';
import searchMaterialsTool from '../../src/tools/plugins/search_materials.js';

describe('material master tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const user = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: user.userId, email: user.email, role: user.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('create_material', () => {
    it('creates a material with an auto-generated MAT-#### code and an auto-provisioned zero StockBalance', async () => {
      const result = await createMaterialTool.handler(ctx, {
        name: `Steel Rod ${randomUUID()}`,
        uom: 'KG',
        stockType: 'PER_JOB',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const material = result.data as { id: string; code: string };
      expect(material.code).toMatch(/^MAT-\d{4}$/);

      // trg_create_balance_row is a DB-trigger effect Layer 1 already tests
      // directly — re-confirming it here proves create_material's own
      // insert actually fires it end to end, not just that the trigger
      // itself works in isolation.
      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(balance.quantity.toNumber()).toBe(0);
      expect(balance.averageRate.toNumber()).toBe(0);
      expect(balance.stockValue.toNumber()).toBe(0);
    });

    it('returns DUPLICATE_MATERIAL_SUSPECTED with the existing match when the name is a near-duplicate', async () => {
      const suffix = randomUUID().slice(0, 8);
      const existing = await createTestMaterial(prisma, { name: `Copper Wire ${suffix}`, stockType: 'PER_JOB', minimumLevel: null });

      const result = await createMaterialTool.handler(ctx, {
        // Case-insensitive near-duplicate of the seeded name.
        name: `  copper wire ${suffix}  `.trim().toUpperCase(),
        uom: 'KG',
        stockType: 'PER_JOB',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('DUPLICATE_MATERIAL_SUSPECTED');
      expect((result as { data?: { suggestion?: { id: string } } }).data?.suggestion?.id).toBe(existing.material.id);
    });

    it('returns MISSING_MINIMUM_LEVEL for a STANDING material with no minimumLevel', async () => {
      const result = await createMaterialTool.handler(ctx, {
        name: `Standing Item ${randomUUID()}`,
        uom: 'NOS',
        stockType: 'STANDING',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('MISSING_MINIMUM_LEVEL');
    });
  });

  describe('update_material', () => {
    it('updates an allowed field', async () => {
      const { material } = await createTestMaterial(prisma);
      const newName = `Renamed ${randomUUID()}`;

      const result = await updateMaterialTool.handler(ctx, { materialId: material.id, name: newName });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { name: string }).name).toBe(newName);
    });

    it('rejects a request that carries uom, rather than silently dropping it', async () => {
      const { material } = await createTestMaterial(prisma);

      const result = await updateMaterialTool.handler(ctx, { materialId: material.id, uom: 'NOS' } as never);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('IMMUTABLE_FIELD');

      const unchanged = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });
      expect(unchanged.uom).toBe(material.uom);
    });

    it('rejects a request that carries stockType, rather than silently dropping it', async () => {
      const { material } = await createTestMaterial(prisma, { stockType: 'PER_JOB' });

      const result = await updateMaterialTool.handler(ctx, { materialId: material.id, stockType: 'STANDING' } as never);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('IMMUTABLE_FIELD');

      const unchanged = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });
      expect(unchanged.stockType).toBe('PER_JOB');
    });
  });

  describe('deactivate_material', () => {
    it('deactivates a material with zero stock on hand', async () => {
      const { material } = await createTestMaterial(prisma);

      const result = await deactivateMaterialTool.handler(ctx, { materialId: material.id, reason: 'discontinued' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data as { isActive: boolean }).isActive).toBe(false);
    });

    it('returns MATERIAL_HAS_STOCK when stock is nonzero', async () => {
      const { material } = await createTestMaterial(prisma);
      // No issue_material tool exists yet — the simplest way to get real
      // stock on hand today is posting a RECEIPT movement directly through
      // Prisma, the same trigger-driven path withStock uses for Layer 1.
      await withStock(prisma, material.id, 25, 10);

      const result = await deactivateMaterialTool.handler(ctx, { materialId: material.id, reason: 'discontinued' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('MATERIAL_HAS_STOCK');
    });
  });

  describe('get_material_balance', () => {
    it('returns the balance for a single material', async () => {
      const { material } = await createTestMaterial(prisma);
      await withStock(prisma, material.id, 5, 40);

      const result = await getMaterialBalanceTool.handler(ctx, { materialIds: [material.id] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const balances = result.data as { materialId: string; quantity: { toNumber(): number } }[];
      expect(balances).toHaveLength(1);
      expect(balances[0].materialId).toBe(material.id);
      expect(Number(balances[0].quantity)).toBe(5);
    });

    it('returns balances for multiple materials in one call', async () => {
      const { material: materialA } = await createTestMaterial(prisma);
      const { material: materialB } = await createTestMaterial(prisma);

      const result = await getMaterialBalanceTool.handler(ctx, { materialIds: [materialA.id, materialB.id] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = (result.data as { materialId: string }[]).map((b) => b.materialId).sort();
      expect(ids).toEqual([materialA.id, materialB.id].sort());
    });
  });

  describe('search_materials', () => {
    it('matches by case-insensitive substring', async () => {
      const suffix = randomUUID().slice(0, 8);
      await createTestMaterial(prisma, { name: `Anodized Bracket ${suffix}` });

      const result = await searchMaterialsTool.handler(ctx, { query: `anodized bracket ${suffix}`.toUpperCase() });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const names = (result.data as { name: string }[]).map((m) => m.name);
      expect(names.some((n) => n.toLowerCase().includes(`anodized bracket ${suffix}`))).toBe(true);
    });

    // create_material's own "returns DUPLICATE_MATERIAL_SUSPECTED" test
    // above already exercises search_materials as create_material's
    // duplicate-detection path (findMaterialsByName is the same function
    // both call) — not re-asserted here to avoid two tests making
    // contradictory claims about the same lookup.
  });
});
