import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createUser } from '../factories/users.js';
import type { ToolContext } from '../../src/tools/types.js';
import registerTool from '../../src/tools/plugins/register.js';
import createUserTool from '../../src/tools/plugins/create_user.js';
import loginTool from '../../src/tools/plugins/login.js';
import whoamiTool from '../../src/tools/plugins/whoami.js';
import { createTestUser } from '../infra/testUser.js';

// register/login are requiresAuth: false — their real ctx (built by
// tools.router.ts) always has userId/email/role: null, regardless of any
// Authorization header. Constructed by hand here rather than via
// createTestUser/createTestUser's token, to match that real shape.
function unauthenticatedCtx(prisma: PrismaClient): ToolContext {
  return { userId: null, email: null, role: null, prisma };
}

describe('identity tools (in-process)', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await startTestDatabase();
    prisma = getTestPrismaClient(db.connectionString);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await db.container.stop();
  });

  describe('register', () => {
    // This test must run against a User table that's genuinely empty —
    // it's the one place in this suite that exercises the "first account
    // ever created" branch. Asserted explicitly (rather than assumed) so a
    // future reordering of this file fails loudly instead of silently
    // asserting the wrong thing.
    it('grants OWNER to the very first account ever created, with no role in the request', async () => {
      expect(await prisma.user.count()).toBe(0);

      const email = `register-first-${randomUUID().slice(0, 8)}@example.test`;
      const result = await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-real-password' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { accessToken: string; userId: string; email: string; role: string };
      expect(typeof data.accessToken).toBe('string');
      expect(data.email).toBe(email);
      expect(data.role).toBe('OWNER');

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: data.userId } });
      expect(stored.role).toBe('OWNER');
    });

    it('forces every self-registration after the first to STOREKEEPER, regardless of payload', async () => {
      // Seeded directly via Prisma (bypassing register) so this test's
      // outcome doesn't depend on the previous test having run first — it
      // only needs the User table to be non-empty going in.
      await createUser(prisma);

      const email = `register-second-${randomUUID().slice(0, 8)}@example.test`;
      const result = await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-real-password' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { userId: string; role: string };
      expect(data.role).toBe('STOREKEEPER');

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: data.userId } });
      expect(stored.role).toBe('STOREKEEPER');
    });

    it('returns DUPLICATE_EMAIL on a second registration with the same email', async () => {
      const email = `register-dup-${randomUUID().slice(0, 8)}@example.test`;
      await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-real-password' });

      const result = await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-different-password' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('DUPLICATE_EMAIL');
    });

    it('rejects a request body containing `role` at the schema level — not a silent strip', () => {
      // register's inputSchema no longer has a `role` field at all, and is
      // `.strict()` — a caller sending one must get a validation failure
      // here, which is exactly what tools.router.ts's
      // `tool.inputSchema.safeParse(request.body?.args)` turns into an HTTP
      // 400/INVALID_ARGS. Asserted at the schema directly rather than over
      // HTTP, matching this file's existing handler-level convention.
      const parsed = registerTool.inputSchema.safeParse({
        email: `register-role-rejected-${randomUUID().slice(0, 8)}@example.test`,
        password: 'a-real-password',
        role: 'OWNER',
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe('create_user', () => {
    it('succeeds as OWNER and creates an account with the requested role', async () => {
      const owner = await createTestUser(prisma, { role: 'OWNER' });
      const ownerCtx: ToolContext = { userId: owner.userId, email: owner.email, role: owner.role, prisma };
      const email = `create-user-owner-${randomUUID().slice(0, 8)}@example.test`;

      const result = await createUserTool.handler(ownerCtx, { email, password: 'a-real-password', role: 'OWNER' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { userId: string; email: string; role: string };
      expect(data.email).toBe(email);
      expect(data.role).toBe('OWNER');

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: data.userId } });
      expect(stored.role).toBe('OWNER');
    });

    it('is refused for a STOREKEEPER caller with FORBIDDEN_NOT_OWNER, and creates no account', async () => {
      const storekeeper = await createTestUser(prisma, { role: 'STOREKEEPER' });
      const storekeeperCtx: ToolContext = {
        userId: storekeeper.userId,
        email: storekeeper.email,
        role: storekeeper.role,
        prisma,
      };
      const email = `create-user-forbidden-${randomUUID().slice(0, 8)}@example.test`;

      const result = await createUserTool.handler(storekeeperCtx, {
        email,
        password: 'a-real-password',
        role: 'STOREKEEPER',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FORBIDDEN_NOT_OWNER');

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).toBeNull();
    });

    it('rejects an unknown role string at the schema level, creating no account', async () => {
      const email = `create-user-unknown-role-${randomUUID().slice(0, 8)}@example.test`;

      const parsed = createUserTool.inputSchema.safeParse({ email, password: 'a-real-password', role: 'SUPERADMIN' });
      expect(parsed.success).toBe(false);

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).toBeNull();
    });

    it('returns DUPLICATE_EMAIL when the email is already registered, creating no second account', async () => {
      const owner = await createTestUser(prisma, { role: 'OWNER' });
      const ownerCtx: ToolContext = { userId: owner.userId, email: owner.email, role: owner.role, prisma };
      const existing = await createUser(prisma);

      const result = await createUserTool.handler(ownerCtx, {
        email: existing.email as string,
        password: 'a-real-password',
        role: 'STOREKEEPER',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('DUPLICATE_EMAIL');
    });
  });

  describe('login', () => {
    const password = 'a-known-login-password';

    it('succeeds with correct credentials', async () => {
      const user = await createUser(prisma, { password });

      const result = await loginTool.handler(unauthenticatedCtx(prisma), { email: user.email as string, password });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { userId: string; email: string };
      expect(data.userId).toBe(user.id);
    });

    it('returns the identical INVALID_CREDENTIALS error for a wrong password and for an unknown email', async () => {
      const user = await createUser(prisma, { password });

      const wrongPassword = await loginTool.handler(unauthenticatedCtx(prisma), {
        email: user.email as string,
        password: 'not-the-right-password',
      });
      const unknownEmail = await loginTool.handler(unauthenticatedCtx(prisma), {
        email: `no-such-user-${randomUUID().slice(0, 8)}@example.test`,
        password: 'anything',
      });

      expect(wrongPassword.ok).toBe(false);
      expect(unknownEmail.ok).toBe(false);
      if (wrongPassword.ok || unknownEmail.ok) return;

      expect(wrongPassword.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.code).toBe('INVALID_CREDENTIALS');
      // Not just the same code — the exact same message string, so neither
      // response leaks which case actually happened.
      expect(wrongPassword.error).toBe(unknownEmail.error);
    });
  });

  describe('whoami', () => {
    it("returns the caller's identity from ctx, not a fresh DB lookup", async () => {
      const user = await createUser(prisma, { role: 'STOREKEEPER' });
      const ctx: ToolContext = { userId: user.id, email: user.email as string, role: 'STOREKEEPER', prisma };

      // Mutate the underlying row's role after the ctx (i.e. the token
      // claims) was already established — a fresh DB lookup would now see
      // OWNER, but whoami must keep reporting the ctx's own STOREKEEPER.
      await prisma.user.update({ where: { id: user.id }, data: { role: 'OWNER' } });

      const result = await whoamiTool.handler(ctx, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { userId: string; email: string; role: string };
      expect(data).toEqual({ userId: user.id, email: user.email, role: 'STOREKEEPER' });
    });
  });
});
