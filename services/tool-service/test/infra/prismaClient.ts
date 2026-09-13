import { PrismaClient } from '@prisma/client';

/**
 * Layer 1's testDatabase.ts only ever returns a connection string (Layer 1
 * deliberately avoided Prisma — raw `pg` only). Layer 2's handler tests need
 * a real PrismaClient pointed at that same Testcontainers instance, so this
 * is a thin wrapper rather than a change to startTestDatabase's own return
 * shape, which Layer 1's own tests already depend on.
 */
export function getTestPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: connectionString } } });
}
