import { z } from 'zod';
import * as bcrypt from 'bcrypt';
import { isRole } from '@org/shared-auth';
import { UserRole } from '@prisma/client';
import type { ToolDefinition } from '../types.js';
import { signToken } from '../../auth/jwt.js';
import { loadConfig } from '../../config.js';

// Self-registration defaults to the least-privileged role rather than trusting
// a caller-supplied role uncritically; a caller-supplied role is only honored
// if it's one of shared-auth's known roles.
const DEFAULT_ROLE = 'STOREKEEPER';
const BCRYPT_COST = 12;

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.string().optional(),
});

type Args = z.infer<typeof inputSchema>;

const config = loadConfig();

const tool: ToolDefinition<Args> = {
  name: 'register',
  description: 'Create a new user account and return an access token.',
  inputSchema,
  requiresAuth: false,
  mutates: true,
  handler: async (ctx, args) => {
    const existing = await ctx.prisma.user.findUnique({ where: { email: args.email } });
    if (existing) {
      return { ok: false, error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' };
    }

    const role = args.role && isRole(args.role) ? args.role : DEFAULT_ROLE;
    const passwordHash = await bcrypt.hash(args.password, BCRYPT_COST);

    const user = await ctx.prisma.user.create({
      data: {
        name: args.email,
        email: args.email,
        role: role as UserRole,
        passwordHash,
      },
    });

    const accessToken = signToken({ sub: user.id, email: args.email, role }, config.jwtSecret);

    return { ok: true, data: { accessToken, userId: user.id, email: args.email, role } };
  },
};

export default tool;
