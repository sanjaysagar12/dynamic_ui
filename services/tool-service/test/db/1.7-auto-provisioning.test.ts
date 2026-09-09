import { Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { withRollbackRaw } from '../infra/rollback.js';
import { insertMaterial, insertMovement, getBalance, withTestClient } from './helpers.js';

describe('1.7 auto-provisioning of stock_balances (trg_create_balance_row)', () => {
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

  // What: verifies inserting a Material auto-provisions its stock_balances
  // row at zero, so nothing else in the system has to remember to create it.
  // How: insert a material via the shared helper and immediately read back
  // its stock_balances row, asserting quantity/averageRate/stockValue are
  // all zero.
  it('auto-creates a zero stock_balances row when a new Material is inserted', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      const balance = await getBalance(client, material.id);
      expect(Number(balance.quantity)).toBe(0);
      expect(Number(balance.averageRate)).toBe(0);
      expect(Number(balance.stockValue)).toBe(0);
    }));
  });

  // What: verifies a movement can never silently succeed when its material
  // has no stock_balances row — it must be a hard failure, not a movement
  // recorded with no corresponding balance change.
  // How: delete the auto-created balance row, attempt a RECEIPT for that
  // material, assert it throws a clear "No stock_balances row" exception,
  // recover the aborted transaction with a SAVEPOINT, then confirm no
  // stock_movements row was left behind for that material.
  it('raises a clear exception when a movement is inserted for a material with no balance row, instead of silently recording it', async () => {
    await withTestClient(pool, (client) => withRollbackRaw(client, async (client) => {
      const material = await insertMaterial(client);
      await client.query(`DELETE FROM stock_balances WHERE "materialId" = $1`, [material.id]);

      // A raised exception aborts the whole INSERT statement, which leaves
      // the surrounding transaction itself in an aborted state until an
      // explicit ROLLBACK (or ROLLBACK TO SAVEPOINT) — so the follow-up
      // SELECT below needs a savepoint to recover a usable transaction.
      await client.query('SAVEPOINT before_failed_insert');
      await expect(insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 10, rate: 5 })).rejects.toMatchObject(
        { message: expect.stringMatching(/No stock_balances row for material/) },
      );
      await client.query('ROLLBACK TO SAVEPOINT before_failed_insert');

      const movementCount = await client.query(`SELECT COUNT(*)::int AS count FROM stock_movements WHERE "materialId" = $1`, [
        material.id,
      ]);
      expect(movementCount.rows[0].count).toBe(0);
    }));
  });
});
