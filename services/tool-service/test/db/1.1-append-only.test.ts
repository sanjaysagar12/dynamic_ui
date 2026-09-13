import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { createElevatedRole } from '../infra/roles.js';
import { insertMaterial, insertMovement } from './helpers.js';

// inventory_guards.sql's §8 comment: "THE LEDGER IS APPEND-ONLY. No UPDATE.
// No DELETE. Ever." — both stock_movements and audit_events are guarded by
// the same block_ledger_mutation() trigger function (confirmed against the
// real file; the assumed name in the source spec matches exactly).

describe('1.1 append-only ledger guard', () => {
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

  // What: proves stock_movements is append-only — an UPDATE must be rejected.
  // How: insert a movement via the shared helper, attempt a raw UPDATE on it,
  // assert it throws with block_ledger_mutation's message/context, then
  // re-SELECT the row to confirm the quantity is still what it was.
  it('blocks UPDATE on stock_movements and leaves the row unchanged', async () => {
    const client = await pool.connect();
    try {
      const material = await insertMaterial(client);
      const movement = await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 10, rate: 5 });

      await expect(client.query(`UPDATE stock_movements SET quantity = 999 WHERE id = $1`, [movement.id])).rejects.toMatchObject({
        message: expect.stringMatching(/append-only/i),
        where: expect.stringMatching(/block_ledger_mutation/),
      });

      const after = await client.query(`SELECT quantity FROM stock_movements WHERE id = $1`, [movement.id]);
      expect(Number(after.rows[0].quantity)).toBe(10);
    } finally {
      client.release();
    }
  });

  // What: proves the same append-only guard also blocks DELETE, not just UPDATE.
  // How: insert a movement, attempt a raw DELETE, assert it throws the same
  // block_ledger_mutation error, then re-SELECT to prove the row is still
  // there with all of its original data intact.
  it('blocks DELETE on stock_movements and the row survives, unchanged', async () => {
    const client = await pool.connect();
    try {
      const material = await insertMaterial(client);
      const movement = await insertMovement(client, { materialId: material.id, type: 'RECEIPT', quantity: 10, rate: 5 });

      await expect(client.query(`DELETE FROM stock_movements WHERE id = $1`, [movement.id])).rejects.toMatchObject({
        message: expect.stringMatching(/append-only/i),
        where: expect.stringMatching(/block_ledger_mutation/),
      });

      const after = await client.query(`SELECT * FROM stock_movements WHERE id = $1`, [movement.id]);
      expect(after.rows).toHaveLength(1);
      expect(Number(after.rows[0].quantity)).toBe(10);
    } finally {
      client.release();
    }
  });

  // What: confirms audit_events carries the same append-only guarantee as
  // stock_movements — this matters because withAuditedTransaction's whole
  // audit-trail promise depends on audit rows themselves being immutable.
  // How: insert an audit_events row directly via raw SQL, attempt an UPDATE
  // then a DELETE, assert both are rejected by the same trigger function,
  // then re-SELECT to confirm the row's `action` column never changed.
  it('blocks UPDATE and DELETE on audit_events the same way (trg_block_audit_update)', async () => {
    const client = await pool.connect();
    try {
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO audit_events (id, "entityType", "entityId", action, "actorType")
         VALUES ($1, 'StockMovement', $2, 'CREATE', 'HUMAN')`,
        [auditId, randomUUID()],
      );

      await expect(client.query(`UPDATE audit_events SET action = 'REVERSE' WHERE id = $1`, [auditId])).rejects.toMatchObject({
        message: expect.stringMatching(/append-only/i),
        where: expect.stringMatching(/block_ledger_mutation/),
      });

      await expect(client.query(`DELETE FROM audit_events WHERE id = $1`, [auditId])).rejects.toMatchObject({
        message: expect.stringMatching(/append-only/i),
        where: expect.stringMatching(/block_ledger_mutation/),
      });

      const after = await client.query(`SELECT action FROM audit_events WHERE id = $1`, [auditId]);
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0].action).toBe('CREATE');
    } finally {
      client.release();
    }
  });

  // What: proves the guard is a real trigger enforced by Postgres itself, not
  // just a convention that happens to hold because tool-service's own
  // connection role is unprivileged — even a superuser-level role must obey it.
  // How: insert a movement as the normal test role, release that connection,
  // then open a brand-new connection as a separately provisioned elevated
  // Postgres role (test/infra/roles.ts) and attempt the same UPDATE/DELETE,
  // asserting they're still blocked and the row is still unchanged.
  it('is not scoped to the app role — an elevated, distinct Postgres role is blocked too', async () => {
    const setupClient = await pool.connect();
    let movementId: string;
    try {
      const material = await insertMaterial(setupClient);
      const movement = await insertMovement(setupClient, { materialId: material.id, type: 'RECEIPT', quantity: 10, rate: 5 });
      movementId = movement.id;
    } finally {
      setupClient.release();
    }

    const elevated = await createElevatedRole(db);
    const elevatedClient = new Client({ connectionString: elevated.connectionString });
    await elevatedClient.connect();
    try {
      await expect(elevatedClient.query(`UPDATE stock_movements SET quantity = 999 WHERE id = $1`, [movementId])).rejects.toMatchObject(
        { message: expect.stringMatching(/append-only/i) },
      );
      await expect(elevatedClient.query(`DELETE FROM stock_movements WHERE id = $1`, [movementId])).rejects.toMatchObject({
        message: expect.stringMatching(/append-only/i),
      });

      const after = await elevatedClient.query(`SELECT quantity FROM stock_movements WHERE id = $1`, [movementId]);
      expect(after.rows).toHaveLength(1);
      expect(Number(after.rows[0].quantity)).toBe(10);
    } finally {
      await elevatedClient.end();
    }
  });
});
