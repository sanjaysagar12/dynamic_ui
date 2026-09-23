import * as bcrypt from 'bcrypt';
import type { Prisma, PrismaClient, User, UserRole } from '@prisma/client';

// register.ts and create_user.ts are the only two places a User row is ever
// created — this holds the hashing/creation logic they share so it exists
// in exactly one place, even though each tool wraps it differently
// (register: no audit trail, since it's requiresAuth: false; create_user:
// inside withAuditedTransaction, since it's an authed, audited mutation).
const BCRYPT_COST = 12;

export type UserDb = PrismaClient | Prisma.TransactionClient;

export interface CreateUserAccountArgs {
  email: string;
  password: string;
  role: UserRole;
}

export async function findExistingUser(db: UserDb, email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export async function createUserRecord(db: UserDb, args: CreateUserAccountArgs): Promise<User> {
  const passwordHash = await bcrypt.hash(args.password, BCRYPT_COST);
  return db.user.create({
    data: {
      name: args.email,
      email: args.email,
      role: args.role,
      passwordHash,
    },
  });
}
