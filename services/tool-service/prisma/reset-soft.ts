// db:reset:soft — truncates every application table (never
// _prisma_migrations) and restarts identity sequences, without touching
// migration history. Doesn't reapply prisma/inventory_guards.sql — TRUNCATE
// doesn't drop triggers/constraints, so whatever a prior db:reset:full (or
// the original manual setup) applied stays attached to the tables. This is
// the fast path meant to be run repeatedly during a manual testing session.
//
// The table list below is written out explicitly from schema.prisma's
// @@map names rather than introspected at runtime — easier to audit, and it
// can't silently start truncating a newly added table without a deliberate
// edit here.
//
// Truncating number_series is required for reproducibility: prisma/seed.ts
// mints human-readable doc numbers (MAT-####, JOB-<FY>-####, PO-<FY>-####,
// ...) via numberSeries.ts's atomic upsert, keyed off this table — a fresh
// reset must start that numbering from scratch every time, or the doc
// numbers a human references in MANUAL_TESTING.md drift after the first
// reset.
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { assertLocalDatabase } from './lib/localDbGuard.js';

loadDotenv({ path: resolve(__dirname, '../.env') });
assertLocalDatabase(process.env.DATABASE_URL);

// Order doesn't matter — TRUNCATEing every FK-related table together in one
// statement, plus CASCADE, handles the relationships between them.
const APPLICATION_TABLES = [
  'users',
  'parties',
  'settings',
  'number_series',
  'audit_events',
  'notifications',
  'attachments',
  'materials',
  'stock_balances',
  'lots',
  'stock_movements',
  'purchase_orders',
  'purchase_order_lines',
  'goods_receipts',
  'goods_receipt_lines',
  'customer_pos',
  'jobs',
  'job_bom_lines',
  'stock_counts',
  'stock_count_lines',
  'scrap_sales',
];

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sql = `TRUNCATE TABLE ${APPLICATION_TABLES.join(', ')} RESTART IDENTITY CASCADE;`;
    console.log(`→ truncating ${APPLICATION_TABLES.length} application tables`);
    await client.query(sql);
    console.log('✓ Soft reset complete — data cleared, migration history and schema untouched.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Soft reset failed:', err);
  process.exit(1);
});
