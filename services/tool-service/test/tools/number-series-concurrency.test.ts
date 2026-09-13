import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { nextNumber } from '../../src/lib/numberSeries.js';

// nextNumber's own docstring: "must run inside the caller's own transaction
// ... so a failed insert also rolls back the number bump" — each call below
// gets its own real, independently-committed prisma.$transaction, fired
// concurrently, mirroring how every tool that mints a number actually calls
// it (one transaction per create_material/create_job/create_purchase_order/
// record_goods_receipt call, not a shared one).
async function fireNextNumber(prisma: PrismaClient, prefix: string, fiscalYear = ''): Promise<string> {
  return prisma.$transaction((tx) => nextNumber(tx, prefix, fiscalYear));
}

describe('NumberSeries / nextNumber — uniqueness under concurrency', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  // One case per prefix currently minted by a real tool: MAT-#### (no FY,
  // create_material), JOB-<FY>-#### (create_job), PO-<FY>-####
  // (create_purchase_order), GRN-<FY>-#### (record_goods_receipt) — not
  // just one prefix, since the atomic upsert's uniqueness is keyed on
  // (docType, financialYear) and a bug scoped to only one of those isn't
  // ruled out by testing just one.
  it.each([
    ['MAT', ''],
    ['JOB', '2627'],
    ['PO', '2627'],
    ['GRN', '2627'],
  ])('10 concurrent nextNumber(tx, %s, %s) calls never produce a duplicate', async (prefix, fiscalYear) => {
    const results = await Promise.all(Array.from({ length: 10 }, () => fireNextNumber(prisma, prefix, fiscalYear)));

    expect(new Set(results).size).toBe(10);
    for (const value of results) {
      expect(value).toMatch(fiscalYear ? new RegExp(`^${prefix}-${fiscalYear}-\\d{4}$`) : new RegExp(`^${prefix}-\\d{4}$`));
    }
  });
});
