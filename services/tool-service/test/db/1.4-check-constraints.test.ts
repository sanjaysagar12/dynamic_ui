import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import {
  insertMaterial,
  insertMovement,
  insertJob,
  insertJobBomLine,
  insertGoodsReceiptLine,
  insertStockCount,
  insertStockCountLine,
  withTestClient,
} from './helpers.js';

// Job and StockCount/StockCountLine both already exist in schema.prisma
// (models `Job` and `StockCount`/`StockCountLine`) — so the Job-quantity and
// count-difference cases below are built in full rather than skipped; see
// the §1.5 scope note for the same finding, restated there for that file.

describe('1.4 check constraints', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.connectionString });
  });

  afterAll(async () => {
    await pool.end();
    await db.container.stop();
  });

  // What: enforces that a movement's quantity must be strictly positive.
  // How: attempt to insert a RECEIPT with quantity 0 and assert the insert
  // fails with the chk_movement_qty_positive CHECK constraint.
  it('rejects a movement with quantity = 0 (chk_movement_qty_positive)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        await expect(insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 0, rate: 5 })).rejects.toMatchObject({
          constraint: 'chk_movement_qty_positive',
        });
      }),
    ));

  // What: proves the same constraint also catches negative quantities —
  // confirming the schema puts sign information in `direction`, never in
  // `quantity` itself.
  // How: attempt to insert a RECEIPT with quantity -5 and assert the same
  // chk_movement_qty_positive constraint rejects it.
  it('rejects a movement with quantity = -5 — sign lives in direction, never in quantity (chk_movement_qty_positive)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        await expect(insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: -5, rate: 5 })).rejects.toMatchObject({
          constraint: 'chk_movement_qty_positive',
        });
      }),
    ));

  // What: enforces that a movement's rate must never be negative.
  // How: seed the material with a large positive value first (see comment
  // below for why), then attempt a second movement with rate -1 and assert
  // chk_movement_rate_positive rejects it.
  it('rejects a movement with rate = -1 (chk_movement_rate_positive)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        // Give the material a large existing positive value first. On a
        // FRESH material (value 0), apply_stock_movement's internal UPDATE
        // to stock_balances would compute a negative averageRate from a
        // negative-rate receipt and hit chk_balance_rate_positive on
        // stock_balances BEFORE the outer INSERT's own row constraints are
        // even checked (BEFORE ROW triggers run first; CHECK constraints on
        // the inserted row are only validated once the trigger returns) —
        // confirmed by observing exactly that failure with a fresh material.
        // With enough existing positive value, blending in one negative-rate
        // receipt keeps the average non-negative, so this test actually
        // isolates chk_movement_rate_positive as intended.
        await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 1000, rate: 100 });
        await expect(insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 10, rate: -1 })).rejects.toMatchObject({
          constraint: 'chk_movement_rate_positive',
        });
      }),
    ));

  // What: enforces that a goods-receipt line's inspection split must add up
  // — accepted + rejected must equal received.
  // How: insert a line where 90 + 5 ≠ 100 and assert chk_grn_split rejects it.
  it('rejects a GRN line where accepted + rejected does not sum to received (chk_grn_split)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        await expect(insertGoodsReceiptLine(client, { receivedQty: 100, acceptedQty: 90, rejectedQty: 5 })).rejects.toMatchObject({
          constraint: 'chk_grn_split',
        });
      }),
    ));

  // What: proves chk_grn_split isn't just always rejecting — a correctly
  // balanced split must succeed.
  // How: insert a line where 100 + 0 == 100 and assert the insert succeeds.
  it('positive control: a GRN line where accepted + rejected == received is accepted (chk_grn_split)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const line = await insertGoodsReceiptLine(client, { receivedQty: 100, acceptedQty: 100, rejectedQty: 0 });
        expect(line.id).toBeDefined();
      }),
    ));

  // What: enforces that a stock-count line's recorded difference can't be
  // "corrected" to something other than countedQty − systemQty — stops a
  // fudged difference from being slipped in directly.
  // How: insert a line with systemQty 100, countedQty 90, but an explicit
  // differenceQty of -5 (mismatched) and assert chk_count_difference rejects it.
  it('rejects a count line where differenceQty does not equal countedQty - systemQty (chk_count_difference)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        await expect(insertStockCountLine(client, { systemQty: 100, countedQty: 90, differenceQty: -5 })).rejects.toMatchObject({
          constraint: 'chk_count_difference',
        });
      }),
    ));

  // What: enforces that a Job's quantity must be positive.
  // How: attempt to insert a Job with quantity 0 and assert chk_job_qty_positive
  // rejects it.
  it('rejects a Job with quantity = 0 (chk_job_qty_positive)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        await expect(insertJob(client, { quantity: 0 })).rejects.toMatchObject({ constraint: 'chk_job_qty_positive' });
      }),
    ));

  // What: enforces that a BOM line's per-piece quantity must be positive.
  // How: attempt to insert a JobBomLine with qtyPerPiece 0 and assert
  // chk_bom_qty_positive rejects it.
  it('rejects a BOM line with qtyPerPiece = 0 (chk_bom_qty_positive)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        await expect(insertJobBomLine(client, { qtyPerPiece: 0, requiredQty: 0 })).rejects.toMatchObject({
          constraint: 'chk_bom_qty_positive',
        });
      }),
    ));

  // What: enforces that every ISSUE names a job — this is what makes
  // per-job material cost automatic from the ledger.
  // How: attempt to insert an ISSUE movement with jobId null and assert
  // chk_issue_has_job rejects it.
  it('rejects an ISSUE movement with jobId = NULL (chk_issue_has_job)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        await expect(
          insertMovement(client, { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 10, rate: 0, jobId: null }),
        ).rejects.toMatchObject({ constraint: 'chk_issue_has_job' });
      }),
    ));

  // What: enforces the same job-required rule for RETURN movements.
  // How: attempt to insert a RETURN movement with jobId null and assert
  // chk_issue_has_job rejects it.
  it('rejects a RETURN movement with jobId = NULL (chk_issue_has_job)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        await expect(
          insertMovement(client, { materialId: material.id, type: 'RETURN', direction: 'IN', quantity: 10, rate: 0, jobId: null }),
        ).rejects.toMatchObject({ constraint: 'chk_issue_has_job' });
      }),
    ));

  // What: enforces that a movement's direction must match its type —
  // a RECEIPT must always be inward.
  // How: attempt to insert a RECEIPT with direction OUT and assert
  // chk_movement_direction rejects it.
  it('rejects a RECEIPT movement with direction = OUT (chk_movement_direction)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        await expect(
          insertMovement(client, { materialId: material.id, type: 'RECEIPT', direction: 'OUT', quantity: 10, rate: 5 }),
        ).rejects.toMatchObject({ constraint: 'chk_movement_direction' });
      }),
    ));

  // What: enforces the mirror-image direction rule — an ISSUE must always
  // be outward.
  // How: attempt to insert an ISSUE with direction IN and assert
  // chk_movement_direction rejects it.
  it('rejects an ISSUE movement with direction = IN (chk_movement_direction)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        const jobId = (await insertJob(client)).id;
        await expect(
          insertMovement(client, { materialId: material.id, type: 'ISSUE', direction: 'IN', quantity: 10, rate: 0, jobId }),
        ).rejects.toMatchObject({ constraint: 'chk_movement_direction' });
      }),
    ));

  // What: proves chk_movement_direction isn't just always rejecting for
  // COUNT_ADJUSTMENT — that type is deliberately exempt from the
  // type/direction pairing and may legitimately go either way once it's
  // linked to an APPROVED count.
  // How: create one APPROVED StockCount with one line per material/direction,
  // then insert both an IN and an OUT COUNT_ADJUSTMENT and assert both succeed.
  it('positive control: COUNT_ADJUSTMENT is allowed with either direction, from an APPROVED count', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        // Two distinct materials — a StockCountLine is unique per
        // (stockCountId, materialId), so testing both directions from the
        // same APPROVED count needs one line per material, not two lines
        // for the same material.
        const materialIn = await insertMaterial(client);
        const materialOut = await insertMaterial(client);
        const approvedCount = await insertStockCount(client, { status: 'APPROVED' });
        const lineIn = await insertStockCountLine(client, {
          stockCountId: approvedCount.id,
          materialId: materialIn.id,
          systemQty: 0,
          countedQty: 10,
        });
        const lineOut = await insertStockCountLine(client, {
          stockCountId: approvedCount.id,
          materialId: materialOut.id,
          systemQty: 10,
          countedQty: 4,
        });

        // Give materialOut enough on-hand stock first so the OUT adjustment
        // below isn't itself the thing driving it negative (§1.8 covers that
        // case separately).
        await insertMovement(client, { materialId: materialOut.id, type: 'RECEIPT', quantity: 10, rate: 5 });

        const inMovement = await insertMovement(client, {
          materialId: materialIn.id,
          type: 'COUNT_ADJUSTMENT',
          direction: 'IN',
          quantity: 10,
          rate: 5,
          stockCountLineId: lineIn.id,
        });
        expect(inMovement.id).toBeDefined();

        const outMovement = await insertMovement(client, {
          materialId: materialOut.id,
          type: 'COUNT_ADJUSTMENT',
          direction: 'OUT',
          quantity: 6,
          rate: 5,
          stockCountLineId: lineOut.id,
        });
        expect(outMovement.id).toBeDefined();
      }),
    ));
});
