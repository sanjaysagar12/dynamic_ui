import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createUser } from '../factories/users.js';
import { createMaterial } from '../factories/materials.js';
import type { ToolContext } from '../../src/tools/types.js';
import listRowsTool from '../../src/tools/plugins/list_rows.js';
import { LIST_ROWS_ALLOWLIST } from '../../src/tools/list-rows-allowlist.js';

// This test intentionally documents a KNOWN GAP that is narrower than it
// used to be. Two things list_rows used to get wrong:
//   1. Arbitrary table/column read (any Prisma model, any column,
//      including user.passwordHash) — FIXED. See
//      src/tools/list-rows-allowlist.ts and the handler in
//      src/tools/plugins/list_rows.ts: only an explicitly allowlisted table
//      can be read at all, and only that table's allowlisted columns are
//      ever selected or filterable/orderable.
//   2. Per-caller ROW scoping within an allowed table (e.g. restricting
//      which rows a given caller can see based on who they are) — STILL
//      OPEN, not attempted by the allowlist fix. See the
//      `// TODO(phase-2): audit and add per-table, per-row ownership
//      scoping` comment in list_rows.ts. This test now exercises that
//      narrower, still-open gap specifically: `material` is an allowed
//      table, and within it there is still no row-level predicate tied to
//      caller identity.
//
// If this test starts FAILING, it means row-level scoping was added. Do
// not "fix" this test to pass again without: (1) confirming the scoping
// change was deliberate, (2) updating this file's comment and assertions
// to describe the new, narrower behavior, (3) updating the TODO comment in
// list_rows.ts to reflect what's now scoped and what (if anything) still
// isn't.
describe('list_rows — deliberate scoping gap (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const user = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: user.userId, email: user.email, role: user.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  it('returns rows seeded under different (hypothetical) owners to a single caller, unscoped by identity', async () => {
    const materialA = await createMaterial(prisma, { name: `List Rows Gap A ${db.connectionString.length}-1` });
    const materialB = await createMaterial(prisma, { name: `List Rows Gap B ${db.connectionString.length}-2` });

    const result = await listRowsTool.handler(ctx, { table: 'material' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = (result.data as { id: string }[]).map((row) => row.id);

    // Both rows come back to this one caller — there is no ownership/role
    // predicate narrowing this result today.
    expect(ids).toEqual(expect.arrayContaining([materialA.id, materialB.id]));
  });
});

describe('list_rows — table/column allowlist (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;
  let ctx: ToolContext;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
    const user = await createTestUser(prisma, { role: 'STOREKEEPER' });
    ctx = { userId: user.userId, email: user.email, role: user.role, prisma };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe.each(['user', 'setting', 'lot', 'auditEvent', 'notification'])('table: %s', (table) => {
    it('is refused with TABLE_NOT_ALLOWED, with no sensitive data anywhere in the response', async () => {
      await createUser(prisma, { password: 'a-real-password' });

      const result = await listRowsTool.handler(ctx, { table });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('TABLE_NOT_ALLOWED');

      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/passwordHash/i);
    });
  });

  it('succeeds for an allowlisted table and returns only the allowlisted columns', async () => {
    await createMaterial(prisma, { name: `List Rows Allowlist ${db.connectionString.length}` });

    const result = await listRowsTool.handler(ctx, { table: 'material' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.data as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);

    const expectedKeys = Object.keys(LIST_ROWS_ALLOWLIST.material.select).sort();
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(expectedKeys);
    }
  });

  it('accepts a `where` on an allowlisted column', async () => {
    const material = await createMaterial(prisma, { name: `List Rows Where ${db.connectionString.length}` });

    const result = await listRowsTool.handler(ctx, { table: 'material', where: { name: material.name } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.data as { id: string }[];
    expect(rows.map((row) => row.id)).toContain(material.id);
  });

  it('rejects a `where` on a non-allowlisted field before running any query', async () => {
    const before = await prisma.material.count();

    const result = await listRowsTool.handler(ctx, {
      table: 'material',
      where: { passwordHash: 'irrelevant' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FIELD_NOT_ALLOWED');

    // No query reached the database over this — the material count is
    // unchanged, which it would trivially be either way for a read, but a
    // thrown Prisma error (unknown column) would have surfaced as a
    // different failure shape than a clean FIELD_NOT_ALLOWED result.
    expect(await prisma.material.count()).toBe(before);
  });

  it('rejects an `orderBy` on a non-allowlisted field before running any query', async () => {
    const result = await listRowsTool.handler(ctx, {
      table: 'material',
      orderBy: 'notAColumnAtAll',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FIELD_NOT_ALLOWED');
  });
});
