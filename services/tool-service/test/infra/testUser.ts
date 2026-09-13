import type { PrismaClient, UserRole } from '@prisma/client';
import { createUser } from '../factories/users.js';
import { signToken } from '../../src/auth/jwt.js';
import { TEST_JWT_SECRET } from './constants.js';

export interface TestUser {
  userId: string;
  email: string;
  role: UserRole;
  accessToken: string;
}

// Login/register's own tests exercise the real password round-trip; every
// other tool's tests just need a caller identity, so this password is never
// asserted against — createUser's own bcrypt hashing (at its cheap test
// cost) still runs, it's just not this factory's concern.
const TEST_PASSWORD = 'test-user-password';

/**
 * Seeds a User row directly via Prisma and mints a token the same way
 * register/login do (signToken, same TEST_JWT_SECRET the test app is booted
 * with) — so a test needing an "other tool"'s caller identity doesn't have
 * to round-trip through the register/login tools just to get one.
 */
export async function createTestUser(prisma: PrismaClient, overrides: { role?: UserRole } = {}): Promise<TestUser> {
  const user = await createUser(prisma, { role: overrides.role, password: TEST_PASSWORD });
  const email = user.email as string;
  const accessToken = signToken({ sub: user.id, email, role: user.role }, TEST_JWT_SECRET);
  return { userId: user.id, email, role: user.role, accessToken };
}
