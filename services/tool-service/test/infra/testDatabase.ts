import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// One container per test FILE (started in that file's own beforeAll, stopped
// in its own afterAll) — not per test, and not one container shared across
// the whole run. Per-test would pay the multi-second container-start cost
// once per `it()`, which is untenable once Layer 1/2 have ~55 tests. One
// container for the entire run is faster but lets state leak between
// unrelated test files that don't both remember to wrap every write in
// withRollback (or that deliberately test non-transactional behaviour, e.g.
// the append-only ledger triggers). Per-file is the balance point: tests
// within a file still share one already-migrated database (so they must use
// withRollback/withRollbackPrisma to stay isolated from each other), but a
// bug in one file's cleanup can't bleed into another file's results.

const TOOL_SERVICE_ROOT = join(__dirname, '..', '..');
const SCHEMA_PATH = join(TOOL_SERVICE_ROOT, 'prisma', 'schema.prisma');
const GUARDS_PATH = join(TOOL_SERVICE_ROOT, 'prisma', 'inventory_guards.sql');

// Pinned to a specific version (not `:latest`) so Docker's local image-layer
// cache is actually reused run over run — a floating tag makes Docker check
// the registry for a newer digest on every pull. 17 is picked to match a
// current, broadly-supported Postgres major; if the real hosted instance is
// ever confirmed to run a different major, update this constant to match —
// a test setup that validates guards against a different major than
// production runs is worse than useless.
const POSTGRES_IMAGE = 'postgres:17-alpine';

export interface TestDatabase {
  connectionString: string;
  container: StartedPostgreSqlContainer;
}

/**
 * Spins up a real, disposable Postgres container; applies every migration
 * under prisma/migrations via `prisma migrate deploy` (the same command a
 * real deploy runs — not `db push`, which would skip the migration history
 * table and diverge from what production actually executes); then applies
 * inventory_guards.sql on top, exactly as it must be applied out-of-band
 * against the real database today (this repo has no migration or seed step
 * that runs inventory_guards.sql automatically — see ARCHITECTURE.md's
 * inventory_guards.sql header — so a test setup that folded it into the
 * Prisma migration path would exercise a deploy sequence prod doesn't
 * actually use).
 *
 * Caller owns the container's lifecycle: call `container.stop()` in the
 * test file's own `afterAll`.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('tool_service_test')
    .withUsername('tool_service_test')
    .withPassword('tool_service_test')
    .start();

  const connectionString = container.getConnectionUri();

  applyMigrations(connectionString);
  await applyInventoryGuards(connectionString);

  return { connectionString, container };
}

function applyMigrations(connectionString: string): void {
  // Invoked as `node <prisma-cli-entrypoint> migrate deploy` rather than
  // shelling out to `npx prisma`/`prisma.cmd` — avoids Windows-vs-POSIX
  // shim differences (this runs both on local Windows dev machines and
  // ubuntu-latest CI runners) while still running the real Prisma CLI
  // command a deploy would use.
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [TOOL_SERVICE_ROOT] });

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      DIRECT_URL: connectionString,
    },
    stdio: 'pipe',
  });
}

async function applyInventoryGuards(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const sql = readFileSync(GUARDS_PATH, 'utf8');
    // A single query() call with no parameters uses pg's simple query
    // protocol, which (unlike the parameterized/extended protocol) allows a
    // string containing multiple ;-separated statements — needed since
    // inventory_guards.sql is one file with ~15 DDL/DML statements.
    await client.query(sql);
  } finally {
    await client.end();
  }
}
