import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import { assertBalanceIntegrityClean } from '../infra/assertions.js';
import { insertMaterial, insertMovement, insertJob, getBalance, withTestClient } from './helpers.js';

describe('1.8 negative stock', () => {
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

  // What: verifies issuing more than is on hand is ALLOWED (not blocked —
  // shop-floor paperwork lags reality) but does surface a warning.
  // How: attach a listener for the raw pg 'notice' event before issuing,
  // issue 100 when only 50 is on hand, assert the resulting balance actually
  // went negative (-50), and assert a NEGATIVE STOCK notice was captured.
  it('allows issuing more than is on hand, goes negative, and raises a NOTICE', async () => {
    const client = await pool.connect();
    const notices: string[] = [];
    const onNotice = (notice: { message?: string }) => {
      if (notice.message) notices.push(notice.message);
    };
    client.on('notice', onNotice);

    try {
      await withRollbackRaw(client, async (client) => {
        const material = await insertMaterial(client);
        const jobId = (await insertJob(client)).id;

        // RECEIPT 50 @ 10 → qty 50, avg 10, value 500.
        await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 50, rate: 10 });

        // ISSUE 100 — only 50 on hand. Allowed; OUT never touches the rate.
        //   new_qty = 50 - 100 = -50
        //   new_avg = 10 (unchanged)
        //   new_value = ROUND(-50 * 10, 2) = -500.00
        await insertMovement(client, { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 100, rate: 0, jobId });

        const balance = await getBalance(client, material.id);
        expect(Number(balance.quantity)).toBe(-50);
        expect(Number(balance.averageRate)).toBe(10);
        expect(Number(balance.stockValue)).toBe(-500);
      });
    } finally {
      client.off('notice', onNotice);
      client.release();
    }

    expect(notices.some((m) => /NEGATIVE STOCK/.test(m))).toBe(true);
  });

  // What: verifies the weighted-average math stays correct across a receipt
  // that crosses the balance back from negative to positive — called out in
  // the source design as the ugliest edge case in the whole model.
  // How: drive the balance to -50/-500 (as above), then post a receipt of
  // 200 @ rate 20 and check the resulting quantity/average/value against a
  // hand-computed expectation, followed by assertBalanceIntegrityClean.
  it('computes the average correctly when a receipt lands on a negative balance (the ugliest edge case)', () =>
    withTestClient(pool, (client) =>
      withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const jobId = (await insertJob(client)).id;

      // Same setup as above: RECEIPT 50@10, ISSUE 100 → qty -50, avg 10, value -500.
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 50, rate: 10 });
      await insertMovement(client, { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 100, rate: 0, jobId });
      const negativeBalance = await getBalance(client, material.id);
      expect(Number(negativeBalance.quantity)).toBe(-50);
      expect(Number(negativeBalance.stockValue)).toBe(-500);

      // RECEIPT 200 @ 20 onto that -50/-500 balance.
      //   v_new_qty = -50 + 200 = 150  (> 0, so the average IS recomputed)
      //   v_new_rate = ROUND((v_value + incoming_value) / v_new_qty, 4)
      //              = ROUND((-500 + 200*20) / 150, 4)
      //              = ROUND((-500 + 4000) / 150, 4)
      //              = ROUND(3500 / 150, 4)
      //              = ROUND(23.333333..., 4)   (70/3, repeating 3s — 5th
      //                decimal is 3, rounds down)
      //              = 23.3333
      //   v_new_val  = ROUND(150 * 23.3333, 2) = ROUND(3499.995, 2) = 3500.00
      //              (NUMERIC ROUND is half-away-from-zero, and this lands
      //              exactly back on the true total value of 3500 despite
      //              the average itself having been rounded)
      await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 200, rate: 20 });
      const finalBalance = await getBalance(client, material.id);
      expect(Number(finalBalance.quantity)).toBe(150);
      expect(Number(finalBalance.averageRate)).toBeCloseTo(23.3333, 4);
      expect(Number(finalBalance.stockValue)).toBeCloseTo(3500, 2);

      await assertBalanceIntegrityClean(client);
      }),
    ));
});
