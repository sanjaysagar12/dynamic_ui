// db:reset:full — drops and reapplies every migration, then leaves the
// database ready for prisma/seed.ts (run separately, right after this, by
// the db:reset:full npm script).
//
// This is deliberately NOT a bare `prisma migrate reset --force`, even
// though that's the obvious one-liner, for two reasons:
//
// 1. `migrate reset --force` (with no --skip-seed) runs the configured
//    `prisma.seed` command itself, immediately after replaying migrations —
//    before this script would ever get a chance to apply
//    prisma/inventory_guards.sql. Every seeded write goes through the real
//    tool handlers, which rely on triggers inventory_guards.sql defines
//    (trg_create_balance_row, trg_apply_stock_movement, ...) — without them
//    applied first, seeding would fail immediately. This repo has no
//    migration or seed step that applies inventory_guards.sql automatically
//    (see test/infra/testDatabase.ts's own comment on this — the same gap
//    exists here, applied out-of-band exactly as it must be against the
//    real database today).
// 2. The local-database safety guard has to run BEFORE the destructive
//    `migrate reset` call, not after — checking inside seed.ts alone would
//    be too late, since by the time seed.ts runs the database would already
//    be dropped.
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { assertLocalDatabase } from './lib/localDbGuard.js';

loadDotenv({ path: resolve(__dirname, '../.env') });
assertLocalDatabase(process.env.DATABASE_URL);

const TOOL_SERVICE_ROOT = resolve(__dirname, '..');
const SCHEMA_PATH = resolve(__dirname, 'schema.prisma');
const GUARDS_PATH = resolve(__dirname, 'inventory_guards.sql');

function runMigrateReset(): void {
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [TOOL_SERVICE_ROOT] });

  console.log('→ prisma migrate reset --force --skip-seed');
  execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'reset', '--force', '--skip-seed', '--schema', SCHEMA_PATH],
    {
      cwd: TOOL_SERVICE_ROOT,
      env: process.env as Record<string, string>,
      stdio: 'inherit',
    },
  );
}

async function applyInventoryGuards(): Promise<void> {
  console.log('→ applying inventory_guards.sql');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sql = readFileSync(GUARDS_PATH, 'utf8');
    // A single query() call with no parameters uses pg's simple query
    // protocol, which (unlike the parameterized/extended protocol) allows a
    // string containing multiple ;-separated statements — needed since
    // inventory_guards.sql is one file with ~15 DDL/DML statements. Same
    // convention as test/infra/testDatabase.ts's applyInventoryGuards.
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  runMigrateReset();
  await applyInventoryGuards();
  console.log('✓ Full reset complete — schema replayed from migrations, inventory_guards.sql applied.');
}

main().catch((err) => {
  console.error('Full reset failed:', err);
  process.exit(1);
});
