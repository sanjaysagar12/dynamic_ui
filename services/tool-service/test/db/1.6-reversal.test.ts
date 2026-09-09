import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import { insertMaterial, insertMovement, insertJob, getBalance, withTestClient } from './helpers.js';

describe('1.6 reversal', () => {
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

  // What: verifies a REVERSAL movement can exactly undo a prior OUT
  // movement's effect on the balance.
  // How: post a RECEIPT (setup) then an ISSUE (the movement under test),
  // snapshot the balance from before the ISSUE, then post a REVERSAL linked
  // via reversalOfId — at the current average rate, since an OUT movement
  // never moved it — and confirm the balance lands exactly back on that
  // pre-ISSUE snapshot.
  it('reverses an OUT movement and lands exactly back on the pre-movement balance', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const jobId = (await insertJob(client)).id;

      // Setup: RECEIPT 100 @ 10 → qty 100, avg 10, value 1000.
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 });
      const preMovementBalance = await getBalance(client, material.id);
      expect(Number(preMovementBalance.quantity)).toBe(100);
      expect(Number(preMovementBalance.averageRate)).toBe(10);
      expect(Number(preMovementBalance.stockValue)).toBe(1000);

      // The movement under test: ISSUE 30 (OUT never touches the average).
      //   qty 100 - 30 = 70, avg unchanged 10, value 700.
      const original = await insertMovement(client, {
        materialId: material.id,
        type: 'ISSUE',
        direction: 'OUT',
        quantity: 30,
        rate: 0,
        jobId,
      });
      const postIssueBalance = await getBalance(client, material.id);
      expect(Number(postIssueBalance.quantity)).toBe(70);

      // Reverse it: an IN movement of the same quantity, at the CURRENT
      // average rate (10) — an OUT movement never moved the rate, so
      // reintroducing the same quantity at that same rate is what makes the
      // reversal land exactly back on the pre-movement balance:
      //   new_qty = 70 + 30 = 100
      //   new_avg = (700 + 30*10) / 100 = 1000/100 = 10
      //   new_value = 100 * 10 = 1000  (== preMovementBalance exactly)
      const reversal = await insertMovement(client, {
        materialId: material.id,
        type: 'REVERSAL',
        direction: 'IN',
        quantity: 30,
        rate: 10,
        reversalOfId: original.id,
      });
      expect(reversal.reversalOfId).toBe(original.id);

      const afterReversal = await getBalance(client, material.id);
      expect(Number(afterReversal.quantity)).toBe(Number(preMovementBalance.quantity));
      expect(Number(afterReversal.averageRate)).toBe(Number(preMovementBalance.averageRate));
      expect(Number(afterReversal.stockValue)).toBe(Number(preMovementBalance.stockValue));
    }));
  });

  // What: verifies each movement can be reversed at most once.
  // How: reverse a movement once (succeeds), then attempt a second REVERSAL
  // whose reversalOfId points at that same original movement, and assert
  // the stock_movements_reversalOfId_key unique constraint rejects it.
  it('rejects reversing the same movement a second time (stock_movements_reversalOfId_key)', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const jobId = (await insertJob(client)).id;

      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 });
      const original = await insertMovement(client, {
        materialId: material.id,
        type: 'ISSUE',
        direction: 'OUT',
        quantity: 30,
        rate: 0,
        jobId,
      });

      await insertMovement(client, {
        materialId: material.id,
        type: 'REVERSAL',
        direction: 'IN',
        quantity: 30,
        rate: 10,
        reversalOfId: original.id,
      });

      await expect(
        insertMovement(client, {
          materialId: material.id,
          type: 'REVERSAL',
          direction: 'IN',
          quantity: 30,
          rate: 10,
          reversalOfId: original.id,
        }),
      ).rejects.toMatchObject({ constraint: 'stock_movements_reversalOfId_key' });
    }));
  });

  // What: pins down what the DB actually does when a reversal is itself
  // reversed, since the source spec deliberately leaves this open.
  // How: reverse the original movement once, then post a further REVERSAL
  // that targets that first reversal, and confirm where the balance lands —
  // see the design-choice comment below for why that's the "redo" behavior.
  //
  // Reversing a reversal: the schema doesn't special-case this — reversalOfId
  // is @unique per TARGET movement (each movement can be reversed at most
  // once), but nothing stops that target from itself being a REVERSAL row.
  // Chosen intended behavior for this suite: the DB permits chaining, and
  // "reversing a reversal" is equivalent to redoing the original movement's
  // effect — an OUT-direction reversal-of-the-reversal cancels the IN
  // reversal exactly as any other OUT movement would. Whether the tool layer
  // should ever actually construct this chain is a business-logic decision
  // out of scope for Layer 1; this test only pins down what the DB itself
  // allows and computes.
  it('allows reversing a reversal, landing back on the post-original-movement balance (chosen behavior — see comment above)', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const jobId = (await insertJob(client)).id;

      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 });
      const original = await insertMovement(client, {
        materialId: material.id,
        type: 'ISSUE',
        direction: 'OUT',
        quantity: 30,
        rate: 0,
        jobId,
      });
      const postOriginalBalance = await getBalance(client, material.id);
      expect(Number(postOriginalBalance.quantity)).toBe(70);

      const reversal = await insertMovement(client, {
        materialId: material.id,
        type: 'REVERSAL',
        direction: 'IN',
        quantity: 30,
        rate: 10,
        reversalOfId: original.id,
      });

      // Reverse the reversal — an OUT movement (any rate; OUT never touches
      // the average) that cancels the IN reversal's quantity.
      const reversalOfReversal = await insertMovement(client, {
        materialId: material.id,
        type: 'REVERSAL',
        direction: 'OUT',
        quantity: 30,
        rate: 0,
        reversalOfId: reversal.id,
      });
      expect(reversalOfReversal.reversalOfId).toBe(reversal.id);

      const finalBalance = await getBalance(client, material.id);
      expect(Number(finalBalance.quantity)).toBe(Number(postOriginalBalance.quantity));
      expect(Number(finalBalance.averageRate)).toBe(Number(postOriginalBalance.averageRate));
      expect(Number(finalBalance.stockValue)).toBe(Number(postOriginalBalance.stockValue));
    }));
  });

  // What: verifies reversing a movement never mutates the original row —
  // reversal is purely additive, matching the "corrections are new rows,
  // never edits" design rule.
  // How: snapshot the original movement's full row before reversing it, post
  // the REVERSAL, then re-SELECT the original row and diff every column
  // against the snapshot.
  it('leaves the original movement row completely unchanged after it is reversed', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const jobId = (await insertJob(client)).id;

      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 });
      const original = await insertMovement(client, {
        materialId: material.id,
        type: 'ISSUE',
        direction: 'OUT',
        quantity: 30,
        rate: 0,
        jobId,
      });

      const before = (await client.query(`SELECT * FROM stock_movements WHERE id = $1`, [original.id])).rows[0];

      await insertMovement(client, {
        materialId: material.id,
        type: 'REVERSAL',
        direction: 'IN',
        quantity: 30,
        rate: 10,
        reversalOfId: original.id,
      });

      const after = (await client.query(`SELECT * FROM stock_movements WHERE id = $1`, [original.id])).rows[0];
      expect(after).toEqual(before);
    }));
  });
});
