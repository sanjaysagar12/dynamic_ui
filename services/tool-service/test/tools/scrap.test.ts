import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createTestMaterial } from '../infra/testMaterial.js';
import { createTestScrapMaterial } from '../infra/testScrapMaterial.js';
import { seedStockBalance } from '../infra/testStock.js';
import type { ToolContext } from '../../src/tools/types.js';
import recordScrapInTool from '../../src/tools/plugins/record_scrap_in.js';
import recordScrapSaleTool from '../../src/tools/plugins/record_scrap_sale.js';

describe('scrap tools (in-process)', () => {
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

  describe('record_scrap_in', () => {
    it('a successful call against a scrap material inserts a SCRAP_IN/IN movement and the balance updates correctly', async () => {
      const { material } = await createTestScrapMaterial(prisma);

      const result = await recordScrapInTool.handler(ctx, { materialId: material.id, quantity: 25, rate: 3 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const movement = result.data as { type: string; direction: string; materialId: string };
      expect(movement.type).toBe('SCRAP_IN');
      expect(movement.direction).toBe('IN');
      expect(movement.materialId).toBe(material.id);

      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(Number(balance.quantity)).toBe(25);
      expect(Number(balance.averageRate)).toBe(3);
    });

    it('a call against a non-scrap material returns NOT_SCRAP_MATERIAL and writes nothing', async () => {
      const { material } = await createTestMaterial(prisma, { isScrap: false });
      const before = await prisma.stockMovement.count({ where: { materialId: material.id } });

      const result = await recordScrapInTool.handler(ctx, { materialId: material.id, quantity: 10 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_SCRAP_MATERIAL');

      const after = await prisma.stockMovement.count({ where: { materialId: material.id } });
      expect(after).toBe(before);
    });

    it('rate omitted defaults to 0', async () => {
      const { material } = await createTestScrapMaterial(prisma);

      const result = await recordScrapInTool.handler(ctx, { materialId: material.id, quantity: 10 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const movement = result.data as { rate: unknown };
      expect(Number(movement.rate)).toBe(0);
    });
  });

  describe('record_scrap_sale', () => {
    it('a successful call with sufficient on-hand quantity inserts both ScrapSale and StockMovement{SCRAP_SALE, OUT} in the same transaction', async () => {
      const { material } = await createTestScrapMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 100, averageRate: 5 });

      const result = await recordScrapSaleTool.handler(ctx, {
        materialId: material.id,
        quantity: 20,
        rate: 8,
        saleDate: new Date(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { scrapSale: { id: string; number: string }; movement: { type: string; direction: string } };
      expect(data.scrapSale.number).toMatch(/^SCS-\d{4}-\d{4}$/);
      expect(data.movement.type).toBe('SCRAP_SALE');
      expect(data.movement.direction).toBe('OUT');

      const scrapSaleCount = await prisma.scrapSale.count({ where: { id: data.scrapSale.id } });
      const movementCount = await prisma.stockMovement.count({ where: { scrapSaleId: data.scrapSale.id } });
      expect(scrapSaleCount).toBe(1);
      expect(movementCount).toBe(1);

      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(Number(balance.quantity)).toBe(80);
    });

    it('a call with quantity exceeding on-hand balance succeeds, carries a warning, still inserts the movement, and the balance goes negative', async () => {
      const { material } = await createTestScrapMaterial(prisma);
      await seedStockBalance(prisma, { materialId: material.id, quantity: 10, averageRate: 5 });

      const result = await recordScrapSaleTool.handler(ctx, {
        materialId: material.id,
        quantity: 50,
        rate: 8,
        saleDate: new Date(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { warning?: string; movement: { id: string } };
      expect(data.warning).toBeDefined();

      const movementCount = await prisma.stockMovement.count({ where: { id: data.movement.id } });
      expect(movementCount).toBe(1);

      const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      expect(Number(balance.quantity)).toBe(-40);
    });
  });
});
