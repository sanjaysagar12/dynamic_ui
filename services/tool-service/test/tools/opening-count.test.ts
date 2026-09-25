import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { assertBalanceIntegrityClean } from '../infra/assertions.js';
import { createMaterial } from '../factories/materials.js';
import { createStockCount } from '../factories/stockCounts.js';
import { withStock } from '../factories/stock.js';
import type { ToolContext } from '../../src/tools/types.js';
import startStockCountTool from '../../src/tools/plugins/start_stock_count.js';
import submitCountLineTool from '../../src/tools/plugins/submit_count_line.js';
import submitStockCountTool from '../../src/tools/plugins/submit_stock_count.js';
import approveStockCountTool from '../../src/tools/plugins/approve_stock_count.js';
import rejectStockCountTool from '../../src/tools/plugins/reject_stock_count.js';
import listCountLinesTool from '../../src/tools/plugins/list_count_lines.js';

type LineRow = { id: string; material: string; countedQty: number | null; unitRate: number | null; missing: string | null };

/**
 * The go-live opening count, end to end. The tests in the first block run IN ORDER and share one
 * database, because the rules they check are about sequence: one opening count, before any other
 * stock, approved once.
 */
describe('opening count — go-live flow', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext; // STOREKEEPER
  let ownerCtx: ToolContext;
  let storekeeperId: string;
  let countId: string;
  let wireId: string;
  let coreId: string;
  let stickerId: string;

  const lines = async (): Promise<LineRow[]> => {
    const r = await listCountLinesTool.handler(ctx, { stockCountId: countId });
    if (!r.ok) throw new Error(r.error);
    return r.data as LineRow[];
  };
  const lineFor = async (name: string) => {
    const l = (await lines()).find((x) => x.material === name);
    if (!l) throw new Error(`no line for ${name}`);
    return l;
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const sk = await createTestUser(prisma, { role: 'STOREKEEPER' });
    storekeeperId = sk.userId;
    ctx = { userId: sk.userId, email: sk.email, role: sk.role, prisma };
    const owner = await createTestUser(prisma, { role: 'OWNER' });
    ownerCtx = { userId: owner.userId, email: owner.email, role: owner.role, prisma };

    wireId = (await createMaterial(prisma, { name: '22 SWG Copper Wire', uom: 'KG', stockType: 'PER_JOB' })).id;
    coreId = (await createMaterial(prisma, { name: 'Ferrite Core E-30', uom: 'NOS' })).id;
    stickerId = (await createMaterial(prisma, { name: 'Stickers', uom: 'NOS', stockType: 'PER_JOB' })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('a normal count refuses a rate (rates belong to the opening count only)', async () => {
    const normal = await createStockCount(prisma, { lines: [{ materialId: wireId, countedQty: null }] });
    const result = await submitCountLineTool.handler(ctx, { stockCountLineId: normal.lines[0].id, countedQty: 1, unitRate: 812 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('RATE_NOT_ALLOWED');
  });

  it('starts the opening count with every active material at system quantity 0', async () => {
    const result = await startStockCountTool.handler(ctx, { countDate: new Date(), isOpening: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    countId = (result.data as { id: string }).id;
    const rows = await lines();
    expect(rows.map((r) => r.material)).toEqual(expect.arrayContaining(['22 SWG Copper Wire', 'Ferrite Core E-30', 'Stickers']));
    const all = await prisma.stockCountLine.findMany({ where: { stockCountId: countId } });
    all.forEach((l) => expect(Number(l.systemQty)).toBe(0));
  });

  it('refuses a second opening count while one is in progress', async () => {
    const result = await startStockCountTool.handler(ctx, { countDate: new Date(), isOpening: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('OPENING_IN_PROGRESS');
  });

  it('records a quantity with NO reason, even if one is passed, and says the rate is still needed', async () => {
    const wire = await lineFor('22 SWG Copper Wire');
    const result = await submitCountLineTool.handler(ctx, { stockCountLineId: wire.id, countedQty: 142.6, reasonCode: 'SPILLAGE' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { reasonCode: string | null; note?: string };
    expect(data.reasonCode).toBeNull();
    expect(data.note).toMatch(/rate still needed/i);
  });

  it('adds the rate later on its own, keeping the quantity; the invoice number is optional', async () => {
    const wire = await lineFor('22 SWG Copper Wire');
    const r1 = await submitCountLineTool.handler(ctx, { stockCountLineId: wire.id, unitRate: 812, sourceInvoiceNo: 'CCW/2627/0388' });
    expect(r1.ok).toBe(true);
    const after = await lineFor('22 SWG Copper Wire');
    expect(after.countedQty).toBe(142.6);
    expect(after.unitRate).toBe(812);

    const core = await lineFor('Ferrite Core E-30');
    const r2 = await submitCountLineTool.handler(ctx, { stockCountLineId: core.id, countedQty: 18, unitRate: 65 }); // no invoice
    expect(r2.ok).toBe(true);
  });

  it('can be corrected before submitting (wire 142.6 → 145)', async () => {
    const wire = await lineFor('22 SWG Copper Wire');
    const result = await submitCountLineTool.handler(ctx, { stockCountLineId: wire.id, countedQty: 145 });
    expect(result.ok).toBe(true);
    expect((await lineFor('22 SWG Copper Wire')).countedQty).toBe(145);
  });

  it('refuses to submit with an uncounted material, naming it', async () => {
    const result = await submitStockCountTool.handler(ctx, { stockCountId: countId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPLETE_COUNT');
    expect(result.error).toContain('Stickers');
  });

  it('refuses to submit when a material with stock has no rate, naming it', async () => {
    // count every remaining line; give Stickers a quantity but no rate
    for (const l of await lines()) {
      if (l.countedQty !== null) continue;
      if (l.material === 'Stickers') {
        await submitCountLineTool.handler(ctx, { stockCountLineId: l.id, countedQty: 3000 });
      } else {
        await submitCountLineTool.handler(ctx, { stockCountLineId: l.id, countedQty: 0 }); // zero stock needs no rate
      }
    }
    const result = await submitStockCountTool.handler(ctx, { stockCountId: countId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INCOMPLETE_COUNT');
    expect(result.error).toContain('Stickers');
    expect(result.error).not.toContain('Ferrite');
  });

  it('the database itself refuses to move an opening count on with a missing rate', async () => {
    await expect(prisma.stockCount.update({ where: { id: countId }, data: { status: 'PENDING_APPROVAL' } })).rejects.toThrow(
      /COUNT_INCOMPLETE/,
    );
  });

  it('the database refuses a ₹0 rate', async () => {
    const stickers = await lineFor('Stickers');
    await expect(prisma.stockCountLine.update({ where: { id: stickers.id }, data: { unitRate: 0 } })).rejects.toThrow();
  });

  it('submits once complete, telling the owner the total VALUE, not differences', async () => {
    const stickers = await lineFor('Stickers');
    await submitCountLineTool.handler(ctx, { stockCountLineId: stickers.id, unitRate: 0.5 });

    const result = await submitStockCountTool.handler(ctx, { stockCountId: countId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { isOpening: boolean; openingValue: number };
    expect(data.isOpening).toBe(true);
    expect(data.openingValue).toBeCloseTo(145 * 812 + 18 * 65 + 3000 * 0.5, 2);

    const note = await prisma.notification.findFirst({ where: { entityId: countId, type: 'COUNT_PENDING_APPROVAL' } });
    expect(note?.body).toMatch(/total value/);
  });

  it('stock does not change before approval', async () => {
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: wireId } });
    expect(Number(bal.quantity)).toBe(0);
  });

  it('the storekeeper cannot change a count that is with the owner', async () => {
    const wire = await lineFor('22 SWG Copper Wire');
    const result = await submitCountLineTool.handler(ctx, { stockCountLineId: wire.id, countedQty: 150 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_DRAFT');
  });

  it('sending back notifies the STOREKEEPER, who can fix the same count and resend it', async () => {
    const rejected = await rejectStockCountTool.handler(ownerCtx, { stockCountId: countId, rejectionNote: 'recount the cores' });
    expect(rejected.ok).toBe(true);

    const told = await prisma.notification.findFirst({ where: { entityId: countId, type: 'RECOUNT_REQUIRED', userId: storekeeperId } });
    expect(told).not.toBeNull();

    const core = await lineFor('Ferrite Core E-30');
    const fixed = await submitCountLineTool.handler(ctx, { stockCountLineId: core.id, countedQty: 20 });
    expect(fixed.ok).toBe(true);

    const resent = await submitStockCountTool.handler(ctx, { stockCountId: countId });
    expect(resent.ok).toBe(true);
  });

  it('approval puts each material in as OPENING stock at its invoice rate — not ₹0, not as differences', async () => {
    const result = await approveStockCountTool.handler(ownerCtx, { stockCountId: countId });
    expect(result.ok).toBe(true);

    const wire = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: wireId } });
    expect(Number(wire.quantity)).toBe(145);
    expect(Number(wire.averageRate)).toBe(812);
    expect(Number(wire.stockValue)).toBe(117740);

    const core = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: coreId } });
    expect(Number(core.quantity)).toBe(20);
    expect(Number(core.averageRate)).toBe(65);

    const sticker = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId: stickerId } });
    expect(Number(sticker.averageRate)).toBe(0.5);

    const types = await prisma.stockMovement.groupBy({ by: ['type'], _count: true });
    expect(types.map((t) => t.type)).toEqual(['OPENING']);
    // zero-stock lines post nothing
    const openingRows = await prisma.stockMovement.count({ where: { type: 'OPENING' } });
    expect(openingRows).toBe(3);

    await assertBalanceIntegrityClean(prisma);
  });

  it('the opening count never appears in the leak report', async () => {
    const rows = await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM v_material_leak');
    expect(rows).toHaveLength(0);
  });

  it('refuses another opening count once one is approved', async () => {
    const result = await startStockCountTool.handler(ctx, { countDate: new Date(), isOpening: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('OPENING_ALREADY_DONE');
  });

  it('the database refuses a second APPROVED opening count even if a tool is bypassed', async () => {
    const sneaky = await createStockCount(prisma, { isOpening: true, status: 'PENDING_APPROVAL', lines: [{ materialId: wireId, countedQty: 0 }] });
    await expect(prisma.stockCount.update({ where: { id: sneaky.id }, data: { status: 'APPROVED' } })).rejects.toThrow(
      /OPENING_ALREADY_DONE/,
    );
  });

  it('the database refuses an OPENING movement that did not come from a count', async () => {
    await expect(
      prisma.stockMovement.create({
        data: {
          materialId: wireId,
          type: 'OPENING',
          direction: 'IN',
          quantity: 1,
          rate: 1,
          movementDate: new Date(),
          // stamped by trg_apply_stock_movement — placeholders, same as the tools pass
          value: 0,
          balanceQtyAfter: 0,
          balanceRateAfter: 0,
          balanceValueAfter: 0,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('opening count — must come first', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const sk = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: sk.userId, email: sk.email, role: sk.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('refuses to start once any stock has been recorded', async () => {
    const material = await createMaterial(prisma);
    await withStock(prisma, material.id, 10, 100);

    const result = await startStockCountTool.handler(ctx, { countDate: new Date(), isOpening: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('OPENING_NOT_FIRST');
  });
});
