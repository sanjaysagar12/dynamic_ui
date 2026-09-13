import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createMaterial } from '../factories/materials.js';
import { createCustomer, createSupplier } from '../factories/parties.js';
import { translatePrismaError } from '../../src/lib/translatePrismaError.js';

describe('translatePrismaError (unit tests against real Prisma/Postgres errors)', () => {
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

  async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    throw new Error('captureError: expected fn to throw, but it resolved');
  }

  it('maps a duplicate (customerId, number) violation to DUPLICATE_CUSTOMER_PO', async () => {
    const customer = await createCustomer(prisma);
    const number = `PO-TRANSLATE-TEST-${randomUUID()}`;
    await prisma.customerPo.create({ data: { customerId: customer.id, number, status: 'OPEN' } });

    const err = await captureError(() => prisma.customerPo.create({ data: { customerId: customer.id, number, status: 'OPEN' } }));

    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const translated = translatePrismaError(err);
    expect(translated.code).toBe('DUPLICATE_CUSTOMER_PO');
  });

  // chk_grn_split (inventory_guards.sql) is a real DB-level CHECK constraint —
  // record_goods_receipt.ts's own handler already validates
  // acceptedQty + rejectedQty === receivedQty in-app before ever writing, so
  // this DB-level path is unreachable through that tool today. It's still
  // real, defense-in-depth plumbing (the constraint exists specifically so a
  // future caller that bypasses the handler, or writes GoodsReceiptLine some
  // other way, still can't violate the split) — tested here directly against
  // Prisma, independent of any tool.
  it('maps a chk_grn_split CHECK-constraint violation to SPLIT_MISMATCH', async () => {
    const supplier = await createSupplier(prisma);
    const material = await createMaterial(prisma);
    const goodsReceipt = await prisma.goodsReceipt.create({
      data: { number: `GRN-TRANSLATE-TEST-${randomUUID()}`, supplierId: supplier.id, receiptDate: new Date() },
    });

    const err = await captureError(() =>
      prisma.goodsReceiptLine.create({
        data: {
          goodsReceiptId: goodsReceipt.id,
          materialId: material.id,
          receivedQty: 10,
          acceptedQty: 5,
          rejectedQty: 0, // 5 + 0 !== 10 — violates chk_grn_split
          rate: 5,
          amount: 50,
        },
      }),
    );

    // A CHECK-constraint violation surfaces as PrismaClientUnknownRequestError,
    // not PrismaClientKnownRequestError — confirmed empirically (its raw
    // message is the only place the constraint name shows up) — see
    // translatePrismaError.ts's CHECK_CONSTRAINT_MAP comment.
    expect(err).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    const translated = translatePrismaError(err);
    expect(translated.code).toBe('SPLIT_MISMATCH');
  });

  it('falls back to a generic INTERNAL_ERROR for an unrecognized Prisma error, leaking nothing raw', async () => {
    const err = await captureError(() => prisma.material.findUniqueOrThrow({ where: { id: randomUUID() } }));

    const translated = translatePrismaError(err);
    expect(translated.code).toBe('INTERNAL_ERROR');
    expect(translated.error).toBe('Internal error');
  });
});
