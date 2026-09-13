import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import { insertMaterial, insertMovement, insertJob, getBalance, withTestClient } from './helpers.js';

// apply_stock_movement (inventory_guards.sql §9), confirmed against the real
// trigger body:
//   IN, type <> RETURN → new_avg = ROUND((old_value + qty*rate) / new_qty, 4)
//   IN, type == RETURN → new_avg = old_avg (comes back at the existing
//                         average, not the rate passed on the movement)
//   OUT (any type)     → new_avg unchanged; new_qty = old_qty - qty
//   new_value = ROUND(new_qty * new_avg, 2)

describe('1.2 weighted-average balance maintenance', () => {
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

  // What: verifies apply_stock_movement's weighted-average arithmetic holds
  // across a realistic mixed sequence — two receipts at different rates, an
  // issue, a return, another receipt, an issue-to-exactly-zero, and a
  // receipt onto that zero balance — including the two edge cases (average
  // retained at zero stock; average reset to the incoming rate when value
  // was already zero).
  // How: post one movement at a time inside a single rolled-back
  // transaction, re-reading stock_balances after EVERY step (not just the
  // end) and comparing it to a hand-computed expected value shown in the
  // comment above each step.
  it('walks a full receipt/issue/return/receipt sequence, asserting balance after every step', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);

      // Step 0: freshly created material starts at zero.
      let balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(0);
      expect(Number(balance.averageRate)).toBe(0);
      expect(Number(balance.stockValue)).toBe(0);

      // Step 1: RECEIPT 100 @ rate 10 (rate A) onto empty stock.
      //   new_qty = 0 + 100 = 100
      //   new_avg = (0 + 100*10) / 100 = 1000 / 100 = 10
      //   new_value = 100 * 10 = 1000
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(100);
      expect(Number(balance.averageRate)).toBe(10);
      expect(Number(balance.stockValue)).toBe(1000);

      // Step 2: RECEIPT 100 @ rate 20 (rate B).
      //   new_qty = 100 + 100 = 200
      //   new_avg = (1000 + 100*20) / 200 = (1000 + 2000) / 200 = 3000/200 = 15
      //   new_value = 200 * 15 = 3000
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 20 });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(200);
      expect(Number(balance.averageRate)).toBe(15);
      expect(Number(balance.stockValue)).toBe(3000);

      // Step 3: ISSUE 50 — quantity drops, average UNCHANGED (outward never
      // touches the rate).
      //   new_qty = 200 - 50 = 150
      //   new_avg = 15 (unchanged)
      //   new_value = 150 * 15 = 2250
      const jobId = (await insertJob(client)).id;

      await insertMovement(client, { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 50, rate: 0, jobId });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(150);
      expect(Number(balance.averageRate)).toBe(15);
      expect(Number(balance.stockValue)).toBe(2250);

      // Step 4: RETURN 10 — quantity rises, average STILL unchanged. A
      // RETURN comes back at the existing average (v_rate), not whatever
      // rate is passed on the movement row, so pass rate 0 to make that
      // explicit — it must not influence the balance.
      //   new_qty = 150 + 10 = 160
      //   new_avg = 15 (unchanged — RETURN branch uses v_rate, not NEW.rate)
      //   new_value = 160 * 15 = 2400
      await insertMovement(client, { materialId: material.id, type: 'RETURN', direction: 'IN', quantity: 10, rate: 0, jobId });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(160);
      expect(Number(balance.averageRate)).toBe(15);
      expect(Number(balance.stockValue)).toBe(2400);

      // Step 5: RECEIPT 40 @ rate 30 (rate C).
      //   new_qty = 160 + 40 = 200
      //   new_avg = (2400 + 40*30) / 200 = (2400 + 1200) / 200 = 3600/200 = 18
      //   new_value = 200 * 18 = 3600
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 40, rate: 30 });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(200);
      expect(Number(balance.averageRate)).toBe(18);
      expect(Number(balance.stockValue)).toBe(3600);

      // Step 6: issue the entire stock to exactly zero — average must be
      // RETAINED, not reset to 0 or null.
      //   new_qty = 200 - 200 = 0
      //   new_avg = 18 (retained — OUT branch never touches the rate)
      //   new_value = 0 * 18 = 0
      await insertMovement(client, { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 200, rate: 0, jobId });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(0);
      expect(Number(balance.averageRate)).toBe(18);
      expect(Number(balance.stockValue)).toBe(0);

      // Step 7: RECEIPT onto a zero-quantity-but-nonzero-average material —
      // the new average must equal the incoming rate exactly, since the old
      // value contributes 0 (quantity was already 0, so stockValue was 0).
      //   new_qty = 0 + 50 = 50
      //   new_avg = (0 + 50*25) / 50 = 1250/50 = 25  (== the incoming rate)
      //   new_value = 50 * 25 = 1250
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 50, rate: 25 });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(50);
      expect(Number(balance.averageRate)).toBe(25);
      expect(Number(balance.stockValue)).toBe(1250);
    }));
  });

  // What: verifies the average rounds consistently to the schema's 4-decimal
  // precision even when the true division never terminates, and that
  // quantity × average still lands back on the true total to the currency's
  // 2-decimal precision despite that rounding.
  // How: post two receipts (3 units, then 4 units) whose combined value and
  // quantity produce a repeating decimal (50/7), and compare the resulting
  // balance to a hand-computed expected average/value shown in the comment.
  it('rounds an uneven division consistently to 4 decimal places, with value = quantity × average holding to 2dp', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);

      // RECEIPT 3 @ rate 10 onto empty stock.
      //   new_qty = 3, new_avg = (0 + 3*10)/3 = 10, new_value = 3*10 = 30
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 3, rate: 10 });
      let balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(3);
      expect(Number(balance.averageRate)).toBe(10);
      expect(Number(balance.stockValue)).toBe(30);

      // RECEIPT 4 @ rate 5.
      //   new_qty = 3 + 4 = 7
      //   new_avg = (30 + 4*5) / 7 = (30 + 20) / 7 = 50/7 = 7.142857142857...
      //     repeating decimal 7.1̄42857 — the 5th decimal digit is 5 followed
      //     by further nonzero digits, so NUMERIC ROUND(x, 4) rounds up to
      //     7.1429.
      //   new_value = ROUND(7 * 7.1429, 2) = ROUND(50.0003, 2) = 50.00
      //     (the ledger's true total value is exactly 30 + 20 = 50.00 — the
      //     stored average's rounding error is small enough that
      //     quantity × average still lands back on the exact total to the
      //     currency's 2-decimal minor unit)
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 4, rate: 5 });
      balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(7);
      expect(Number(balance.averageRate)).toBeCloseTo(7.1429, 4);
      expect(Number(balance.stockValue)).toBeCloseTo(50, 2);
    }));
  });
});
