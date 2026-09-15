import 'server-only';
import { PrismaClient } from '../../generated/prisma-client';

// Standard Next.js dev-mode workaround: the dev server hot-reloads this
// module on every source change, which would otherwise construct a fresh
// PrismaClient (and a fresh connection pool) on every edit. Stashing the
// instance on `globalThis` survives the reload; production has no hot
// reload, so it just behaves as a plain module-level singleton there.
const globalForPrisma = globalThis as unknown as { viewerPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.viewerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.viewerPrisma = prisma;
}
