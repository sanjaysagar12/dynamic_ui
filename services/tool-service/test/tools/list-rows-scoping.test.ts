import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createTestUser } from '../infra/testUser.js';
import { createMaterial } from '../factories/materials.js';
import type { ToolContext } from '../../src/tools/types.js';
import listRowsTool from '../../src/tools/plugins/list_rows.js';

// This test intentionally documents a KNOWN GAP, not a passing feature.
// list_rows currently has no per-caller row scoping — see the
// `// TODO(phase-2): audit and add per-table ownership scoping` comment in
// src/tools/plugins/list_rows.ts. This test seeds two materials as two
// different users would (hypothetically — the Material model has no
// ownerId column at all, which is itself part of the gap) and asserts that
// a single caller can currently see rows unscoped by identity.
//
// If this test starts FAILING, it means scoping was added. Do not "fix"
// this test to pass again without: (1) confirming the scoping change was
// deliberate, (2) updating this file's comment and assertions to describe
// the new, narrower behavior, (3) updating the TODO comment in
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
