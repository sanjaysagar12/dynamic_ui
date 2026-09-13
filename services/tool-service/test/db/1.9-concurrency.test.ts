import { Client, Pool } from 'pg';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { assertBalanceIntegrityClean } from '../infra/assertions.js';
import { insertMaterial, insertMovement, insertJob, getBalance } from './helpers.js';

// Real parallel connections, not a single client issuing sequential awaits —
// this is what actually exercises apply_stock_movement's `FOR UPDATE` lock
// on the material's stock_balances row (confirmed present in the trigger
// body). No withRollbackRaw here: each movement below is its own real,
// committed transaction, run concurrently against a shared connection —
// that's the scenario the lock has to serialize correctly.
//
// Run this file 3 times in a row locally before considering it done — see
// the phase brief. (`npx nx test tool-service -- --testPathPattern
// 1.9-concurrency` x3.)

describe('1.9 concurrency', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.connectionString, max: 20 });
  });

  afterAll(async () => {
    await pool.end();
    await db.container.stop();
  });

  // What: proves the trigger's row lock prevents a lost update when two
  // receipts hit the same material's balance at the same time.
  // How: open two independent, real pg.Client connections (not one client
  // issuing sequential awaits), fire a RECEIPT on each concurrently via
  // Promise.all, then check the resulting balance reflects BOTH receipts
  // combined rather than one clobbering the other.
  it('two simultaneous receipts on the same material — no lost update', async () => {
    const setupClient = await pool.connect();
    const material = await insertMaterial(setupClient);
    setupClient.release();

    // Both receipts use the SAME rate (10) so the weighted average is exact
    // and order-independent at every intermediate step — this test's job is
    // to prove the row lock prevents a lost update, not to re-exercise
    // §1.2's weighted-average rounding behavior.
    const clientA = new Client({ connectionString: db.connectionString });
    const clientB = new Client({ connectionString: db.connectionString });
    await clientA.connect();
    await clientB.connect();
    try {
      await Promise.all([
        insertMovement(clientA, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 }),
        insertMovement(clientB, { materialId: material.id, type: 'RECEIPT', quantity: 300, rate: 10 }),
      ]);
    } finally {
      await clientA.end();
      await clientB.end();
    }

    const checkClient = await pool.connect();
    try {
      const balance = await getBalance(checkClient, material.id);
      expect(Number(balance.quantity)).toBe(400);
      expect(Number(balance.averageRate)).toBe(10);
      expect(Number(balance.stockValue)).toBe(4000);
      await assertBalanceIntegrityClean(checkClient);
    } finally {
      checkClient.release();
    }
  });

  // What: proves the same no-lost-update guarantee holds when the two
  // concurrent movements are of DIFFERENT kinds (one inward, one outward),
  // not just two receipts.
  // How: seed a starting balance, then open two real connections and fire a
  // RECEIPT on one and an ISSUE on the other concurrently via Promise.all,
  // asserting the final quantity/average/value reflect both applied correctly.
  it('a simultaneous receipt and issue on the same material — correct final balance and average', async () => {
    const setupClient = await pool.connect();
    const material = await insertMaterial(setupClient);
    const jobId = (await insertJob(setupClient)).id;
    // Starting balance: qty 1000, avg 10, value 10000 (exact, no rounding).
    await insertMovement(setupClient, { materialId: material.id, type: 'RECEIPT', quantity: 1000, rate: 10 });
    setupClient.release();

    const clientA = new Client({ connectionString: db.connectionString });
    const clientB = new Client({ connectionString: db.connectionString });
    await clientA.connect();
    await clientB.connect();
    try {
      await Promise.all([
        // RECEIPT at the SAME rate as the current average (10) — so
        // whichever order the two transactions serialize in, the average
        // this contributes stays exactly 10, and an ISSUE never touches the
        // average either. That keeps the final state deterministic without
        // depending on which of the two wins the row lock first.
        insertMovement(clientA, { materialId: material.id, type: 'RECEIPT', quantity: 100, rate: 10 }),
        insertMovement(clientB, { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 50, rate: 0, jobId }),
      ]);
    } finally {
      await clientA.end();
      await clientB.end();
    }

    const checkClient = await pool.connect();
    try {
      const balance = await getBalance(checkClient, material.id);
      expect(Number(balance.quantity)).toBe(1050);
      expect(Number(balance.averageRate)).toBe(10);
      expect(Number(balance.stockValue)).toBe(10500);
      await assertBalanceIntegrityClean(checkClient);
    } finally {
      checkClient.release();
    }
  });

  // What: stress-tests the row lock at higher concurrency — many materials,
  // many movements each, fired all at once — to catch a race that only shows
  // up under real contention rather than two carefully paired operations.
  // How: build 5 movements per material across 10 materials (50 total),
  // shuffle their order, fire all of them in parallel (one pool connection
  // per movement) via Promise.allSettled, assert none failed, then check
  // every material's final quantity and run assertBalanceIntegrityClean.
  it('50 movements fired in parallel across 10 materials all succeed and leave the ledger consistent', async () => {
    const setupClient = await pool.connect();
    // Sequential, not Promise.all — firing concurrent queries on the SAME
    // client (rather than one connection per concurrent operation) is a
    // deprecated pg pattern that just gets silently serialized internally
    // anyway; this is setup, not the concurrency under test.
    const materials: Awaited<ReturnType<typeof insertMaterial>>[] = [];
    for (let i = 0; i < 10; i++) {
      materials.push(await insertMaterial(setupClient));
    }
    const jobId = (await insertJob(setupClient)).id;
    setupClient.release();

    type PendingMovement = { materialId: string; type: string; direction?: string; quantity: number; rate: number; jobId?: string };
    const movements: PendingMovement[] = [];
    for (const material of materials) {
      movements.push(
        { materialId: material.id, type: 'RECEIPT', quantity: 50, rate: 10 },
        { materialId: material.id, type: 'RECEIPT', quantity: 30, rate: 10 },
        { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 20, rate: 0, jobId },
        { materialId: material.id, type: 'RECEIPT', quantity: 10, rate: 10 },
        { materialId: material.id, type: 'ISSUE', direction: 'OUT', quantity: 15, rate: 0, jobId },
      );
    }

    // Randomly interleave so movements against the same material aren't
    // necessarily fired back-to-back.
    for (let i = movements.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [movements[i], movements[j]] = [movements[j], movements[i]];
    }

    const results = await Promise.allSettled(
      movements.map(async (movement) => {
        const client = await pool.connect();
        try {
          return await insertMovement(client, movement);
        } finally {
          client.release();
        }
      }),
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failures).toHaveLength(0);

    const checkClient = await pool.connect();
    try {
      for (const material of materials) {
        const balance = await getBalance(checkClient, material.id);
        // 50 + 30 - 20 + 10 - 15 = 55 for every material.
        expect(Number(balance.quantity)).toBe(55);
      }
      await assertBalanceIntegrityClean(checkClient);
    } finally {
      checkClient.release();
    }
  });
});
