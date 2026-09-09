import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import { assertBalanceIntegrityClean } from '../infra/assertions.js';
import {
  insertMaterial,
  insertMovement,
  insertJob,
  getBalance,
  assertLedgerReplayMatchesBalance,
  withTestClient,
} from './helpers.js';

describe('1.3 running balance / full-ledger-replay invariant', () => {
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

  // What: verifies the running-balance columns apply_stock_movement stamps
  // onto each stock_movements row (balanceQtyAfter/balanceRateAfter/
  // balanceValueAfter) match stock_balances at that exact point in the
  // sequence — the ledger should be auditable from its own rows, without
  // needing to replay it.
  // How: reuse §1.2's 5-step RECEIPT/RECEIPT/ISSUE/RETURN/RECEIPT sequence,
  // inserting one movement at a time and comparing its own returned
  // balance-after columns against a fresh read of stock_balances taken
  // immediately after.
  it("stamps each movement's own balanceQtyAfter to match stock_balances.quantity at that point in the sequence", async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const jobId = (await insertJob(client)).id;

      // Same sequence as §1.2: RECEIPT 100@10, RECEIPT 100@20, ISSUE 50,
      // RETURN 10, RECEIPT 40@30 — expected running quantities: 100, 200,
      // 150, 160, 200 (see §1.2 for the weighted-average arithmetic).
      const steps: Array<{ type: string; direction?: string; quantity: number; rate: number; jobId?: string }> = [
        { type: 'RECEIPT', quantity: 100, rate: 10 },
        { type: 'RECEIPT', quantity: 100, rate: 20 },
        { type: 'ISSUE', direction: 'OUT', quantity: 50, rate: 0, jobId },
        { type: 'RETURN', direction: 'IN', quantity: 10, rate: 0, jobId },
        { type: 'RECEIPT', quantity: 40, rate: 30 },
      ];
      const expectedQtyAfter = [100, 200, 150, 160, 200];

      for (const [i, step] of steps.entries()) {
        const movement = await insertMovement(client, { materialId: material.id, ...step });
        const balance = await getBalance(client, material.id);

        expect(Number(movement.balanceQtyAfter)).toBe(expectedQtyAfter[i]);
        expect(Number(movement.balanceQtyAfter)).toBe(Number(balance.quantity));
        expect(Number(movement.balanceRateAfter)).toBe(Number(balance.averageRate));
        expect(Number(movement.balanceValueAfter)).toBe(Number(balance.stockValue));
      }

      await assertBalanceIntegrityClean(client);
    }));
  });

  // What: verifies the full-ledger-replay invariant — summing every IN
  // movement minus every OUT movement straight from stock_movements must
  // equal stock_balances.quantity exactly, regardless of what mix of
  // movement types produced it.
  // How: build three materials with different movement histories (receipts
  // only; receipt/issue/return; opening+receipt+two issues+scrap in/out),
  // then check each one with the shared assertLedgerReplayMatchesBalance
  // helper (reused since Phase 6 will likely want the same check) plus
  // assertBalanceIntegrityClean.
  it('replays the full ledger for 3 differently-shaped materials and matches stock_balances.quantity exactly', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const jobId = (await insertJob(client)).id;

      // Material A: receipts only.
      const materialA = await insertMaterial(client);
      await insertMovement(client, { materialId: materialA.id, type: 'RECEIPT', quantity: 20, rate: 5 });
      await insertMovement(client, { materialId: materialA.id, type: 'RECEIPT', quantity: 30, rate: 8 });

      // Material B: receipt, issue, return.
      const materialB = await insertMaterial(client);
      await insertMovement(client, { materialId: materialB.id, type: 'RECEIPT', quantity: 100, rate: 12 });
      await insertMovement(client, { materialId: materialB.id, type: 'ISSUE', direction: 'OUT', quantity: 40, rate: 0, jobId });
      await insertMovement(client, { materialId: materialB.id, type: 'RETURN', direction: 'IN', quantity: 5, rate: 0, jobId });

      // Material C: opening balance, receipt, two issues, scrap in/out.
      const materialC = await insertMaterial(client);
      await insertMovement(client, { materialId: materialC.id, type: 'OPENING', quantity: 15, rate: 3 });
      await insertMovement(client, { materialId: materialC.id, type: 'RECEIPT', quantity: 25, rate: 6 });
      await insertMovement(client, { materialId: materialC.id, type: 'ISSUE', direction: 'OUT', quantity: 10, rate: 0, jobId });
      await insertMovement(client, { materialId: materialC.id, type: 'ISSUE', direction: 'OUT', quantity: 5, rate: 0, jobId });
      await insertMovement(client, { materialId: materialC.id, type: 'SCRAP_IN', quantity: 2, rate: 1 });
      await insertMovement(client, { materialId: materialC.id, type: 'SCRAP_SALE', direction: 'OUT', quantity: 2, rate: 1 });

      for (const material of [materialA, materialB, materialC]) {
        await assertLedgerReplayMatchesBalance(client, material.id);
      }

      await assertBalanceIntegrityClean(client);
    }));
  });
});
