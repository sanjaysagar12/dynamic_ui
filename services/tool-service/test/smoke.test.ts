import { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from './infra/testDatabase.js';
import { assertBalanceIntegrityClean } from './infra/assertions.js';
import { createMaterial } from './factories/materials.js';
import { withStock } from './factories/stock.js';

describe('test-infra smoke test', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = new PrismaClient({ datasources: { db: { url: db.connectionString } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('provisions Postgres with migrations + inventory guards, and the balance ledger stays consistent', async () => {
    const material = await createMaterial(prisma, { stockType: 'STANDING', minimumLevel: 10 });

    await withStock(prisma, material.id, 50, 20);

    const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: material.id } });
    expect(balance.quantity.toNumber()).toBe(50);
    expect(balance.averageRate.toNumber()).toBe(20);
    expect(balance.stockValue.toNumber()).toBe(1000);

    await assertBalanceIntegrityClean(prisma);
  });
});
