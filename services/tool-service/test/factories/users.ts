import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import type { PrismaClient, User, UserRole } from '@prisma/client';

export interface CreateUserOverrides {
  name?: string;
  email?: string | null;
  role?: UserRole;
  password?: string;
  passwordHash?: string;
  isActive?: boolean;
}

// register.ts hashes at cost 12 for real accounts; factory-created users
// aren't exercising real auth security and tests may create many of them,
// so a much cheaper cost keeps the suite fast. Pass `passwordHash` directly
// to skip hashing entirely when a test doesn't care about the password at all.
const TEST_BCRYPT_COST = 4;

/**
 * Backs register/login's User model. Defaults to STOREKEEPER (the same
 * least-privileged default register.ts itself falls back to).
 */
export async function createUser(prisma: PrismaClient, overrides: CreateUserOverrides = {}): Promise<User> {
  const suffix = randomUUID().slice(0, 8);
  const passwordHash = overrides.passwordHash ?? (await bcrypt.hash(overrides.password ?? 'test-password', TEST_BCRYPT_COST));

  return prisma.user.create({
    data: {
      name: overrides.name ?? `Test User ${suffix}`,
      email: overrides.email === undefined ? `test-user-${suffix}@example.test` : overrides.email,
      role: overrides.role ?? 'STOREKEEPER',
      passwordHash,
      isActive: overrides.isActive ?? true,
    },
  });
}
