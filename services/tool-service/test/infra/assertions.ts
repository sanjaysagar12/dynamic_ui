import type { Pool, PoolClient } from 'pg';
import type { PrismaClient } from '@prisma/client';

type QueryCapable = Pool | PoolClient | PrismaClient;

function isPrismaClient(client: QueryCapable): client is PrismaClient {
  return typeof (client as PrismaClient).$queryRawUnsafe === 'function';
}

/**
 * The universal oracle referenced across Layers 1, 2 and 6: v_balance_
 * integrity (inventory_guards.sql) returns one row per material whose
 * stock_balances.quantity has drifted from what stock_movements actually
 * sums to. Zero rows is the only passing state — anything else means the
 * derived balance and the append-only ledger have gone out of sync.
 *
 * Accepts either a raw pg client/pool (Layer 1) or a PrismaClient (Layer 2),
 * so the same oracle works from both test styles against the same schema.
 */
export async function assertBalanceIntegrityClean(client: QueryCapable): Promise<void> {
  const rows = isPrismaClient(client)
    ? await client.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM v_balance_integrity')
    : (await client.query('SELECT * FROM v_balance_integrity')).rows;

  if (rows.length > 0) {
    throw new Error(
      `assertBalanceIntegrityClean: expected 0 rows from v_balance_integrity, found ${rows.length}.\n` +
        `Offending rows:\n${JSON.stringify(rows, null, 2)}`,
    );
  }
}
