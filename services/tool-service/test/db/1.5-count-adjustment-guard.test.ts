import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import { insertMaterial, insertMovement, insertStockCount, insertStockCountLine, withTestClient } from './helpers.js';

// SCOPE NOTE (per the phase brief): `StockCount`/`StockCountLine` and their
// guard trigger (guard_count_adjustment / trg_guard_count_adjustment) already
// exist in schema.prisma and inventory_guards.sql — confirmed by reading both
// files directly — so this file is built in FULL, not skipped. No tool calls
// this trigger yet, but Layer 1 tests raw SQL directly against the guard
// regardless of tool-layer coverage.

describe('1.5 count-adjustment guard (guard_count_adjustment)', () => {
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

  // What: verifies guard_count_adjustment only allows a COUNT_ADJUSTMENT
  // movement when the count it's linked to is APPROVED — DRAFT,
  // PENDING_APPROVAL, and REJECTED must all be rejected. This is "the heart
  // of stop overwriting": stock can't be silently corrected by anything
  // except an owner-approved count line.
  // How: table-driven over each status — create a StockCount at that status
  // with one line, attempt a COUNT_ADJUSTMENT movement against that line, and
  // branch the assertion on whether the attempt should succeed or be
  // rejected with the trigger's "Stock adjustment blocked" message.
  it.each([
    ['DRAFT', false],
    ['PENDING_APPROVAL', false],
    ['REJECTED', false],
    ['APPROVED', true],
  ])('a COUNT_ADJUSTMENT linked to a %s count is %s', (status, shouldSucceed) =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        const count = await insertStockCount(client, { status: status as string });
        const line = await insertStockCountLine(client, {
          stockCountId: count.id,
          materialId: material.id,
          systemQty: 0,
          countedQty: 10,
        });

        const attempt = insertMovement(client, {
          materialId: material.id,
          type: 'COUNT_ADJUSTMENT',
          direction: 'IN',
          quantity: 10,
          rate: 5,
          stockCountLineId: line.id,
        });

        if (shouldSucceed) {
          const movement = await attempt;
          expect(movement.id).toBeDefined();
        } else {
          await expect(attempt).rejects.toMatchObject({
            message: expect.stringMatching(/Stock adjustment blocked/i),
            where: expect.stringMatching(/guard_count_adjustment/),
          });
        }
      }),
    ),
  );

  // What: verifies a COUNT_ADJUSTMENT with no linked count line at all is
  // rejected, regardless of any count's status.
  // How: attempt to insert a COUNT_ADJUSTMENT with stockCountLineId null and
  // assert it's rejected — see the MISMATCH note below for exactly which
  // error actually fires and why.
  //
  // MISMATCH FROM THE ASSUMED BEHAVIOR: a NULL stockCountLineId is NOT
  // actually rejected via the chk_adjustment_has_count CHECK constraint in
  // practice. trg_guard_count_adjustment (BEFORE INSERT) fires before that
  // constraint is ever validated (Postgres validates row CHECK constraints
  // only after BEFORE ROW triggers complete), and its lookup
  // `WHERE scl.id = NEW."stockCountLineId"` finds no row when that id is
  // NULL, leaving v_status NULL — which its own
  // `COALESCE(v_status, 'MISSING')` is deliberately written to handle,
  // producing "Stock adjustment blocked: count is MISSING, owner approval
  // required" before the CHECK constraint is reached. chk_adjustment_has_count
  // still exists exactly as defined in inventory_guards.sql and would fire if
  // the trigger were ever bypassed, but it is not the constraint an ordinary
  // caller actually observes here.
  it('rejects a COUNT_ADJUSTMENT with stockCountLineId = NULL — via the trigger\'s MISSING-status path, not chk_adjustment_has_count', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        await expect(
          insertMovement(client, {
            materialId: material.id,
            type: 'COUNT_ADJUSTMENT',
            direction: 'IN',
            quantity: 10,
            rate: 5,
            stockCountLineId: null,
          }),
        ).rejects.toMatchObject({
          message: expect.stringMatching(/Stock adjustment blocked: count is MISSING/i),
          where: expect.stringMatching(/guard_count_adjustment/),
        });
      }),
    ));
});
