import type { PoolClient } from 'pg';
import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Runs `fn` inside BEGIN/ROLLBACK on a raw pg client — for Layer 1's
 * direct-SQL tests. Rolls back whether `fn` resolves or throws, and
 * re-throws `fn`'s own error afterward (the `finally` never swallows it).
 * Caller owns acquiring/releasing `client` itself.
 */
export async function withRollbackRaw<T>(client: PoolClient, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

// Prisma's interactive transactions ($transaction(async tx => ...)) commit
// automatically when the callback resolves and only roll back when it
// throws — there's no separate "run this and always roll back" primitive.
// So: run `fn`, capture its result, then throw this sentinel to force
// Prisma to roll back; the outer catch below unwraps the sentinel and
// returns the captured result. A real error from `fn` is a different
// exception (not an instance of this class) and propagates unchanged.
class RollbackSentinel<T> extends Error {
  constructor(public readonly result: T) {
    super('withRollbackPrisma: internal rollback sentinel — this should never surface to a caller');
  }
}

/**
 * Runs `fn` inside a Prisma transaction that is always rolled back — for
 * Layer 2's handler tests. See RollbackSentinel above for why Prisma needs
 * a different mechanism than withRollbackRaw's plain BEGIN/ROLLBACK.
 */
export async function withRollbackPrisma<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(async (tx) => {
      const result = await fn(tx);
      throw new RollbackSentinel(result);
    });
    // Unreachable: the callback above always either returns via the
    // RollbackSentinel throw (caught below) or lets a real error propagate.
    throw new Error('withRollbackPrisma: transaction committed instead of rolling back');
  } catch (err) {
    if (err instanceof RollbackSentinel) {
      return err.result as T;
    }
    throw err;
  }
}
