import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { startTestDatabase, type TestDatabase } from '../infra/testDatabase.js';
import { getTestPrismaClient } from '../infra/prismaClient.js';
import { createUser } from '../factories/users.js';
import type { ToolContext } from '../../src/tools/types.js';
import registerTool from '../../src/tools/plugins/register.js';
import loginTool from '../../src/tools/plugins/login.js';
import whoamiTool from '../../src/tools/plugins/whoami.js';

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
    it('creates an account and returns accessToken/userId/email/role, defaulting role to STOREKEEPER', async () => {
      const email = `register-test-${randomUUID().slice(0, 8)}@example.test`;

      const result = await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-real-password' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { accessToken: string; userId: string; email: string; role: string };
      expect(typeof data.accessToken).toBe('string');
      expect(data.email).toBe(email);
      expect(data.role).toBe('STOREKEEPER');
    });

    it('returns DUPLICATE_EMAIL on a second registration with the same email', async () => {
      const email = `register-dup-${randomUUID().slice(0, 8)}@example.test`;
      await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-real-password' });

      const result = await registerTool.handler(unauthenticatedCtx(prisma), { email, password: 'a-different-password' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('DUPLICATE_EMAIL');
    });

    it('does not store an unknown/garbage role string verbatim — falls back to the default role', async () => {
      const email = `register-garbage-role-${randomUUID().slice(0, 8)}@example.test`;

      const result = await registerTool.handler(unauthenticatedCtx(prisma), {
        email,
        password: 'a-real-password',
        role: 'SUPERADMIN',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { userId: string; role: string };
      expect(data.role).toBe('STOREKEEPER');

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: data.userId } });
      expect(stored.role).toBe('STOREKEEPER');
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
