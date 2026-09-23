import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { signToken } from '../../auth/jwt.js';
import { loadConfig } from '../../config.js';
import { findExistingUser, createUserRecord } from '../../lib/createUserAccount.js';

const inputSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
  })
  .strict();

type Args = z.infer<typeof inputSchema>;

const config = loadConfig();

const tool: ToolDefinition<Args> = {
  name: 'register',
  description:
    'Create a user account. Role cannot be requested at registration — the first account ever created on a fresh deployment becomes OWNER automatically; every registration after that is created as STOREKEEPER, regardless of caller. Elevated accounts are provisioned afterward via the owner-only create_user tool. Not used from chat — accounts are set up by the administrator.',
  inputSchema,
  requiresAuth: false,
  mutates: true,
  form: {
    title: 'Create Account',
    fields: [
      { name: 'email', label: 'Email', widget: 'text', required: true },
      { name: 'password', label: 'Password', widget: 'text', required: true, helpText: 'At least 8 characters.' },
    ],
    submitLabel: 'Create account',
  },
  handler: async (ctx, args) => {
    const existing = await findExistingUser(ctx.prisma, args.email);
    if (existing) {
      return { ok: false, error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' };
    }

    // Deliberately ignore any caller-supplied role — see the fix for
    // "Anyone can register as OWNER" in the security review. The first
    // account ever created on a fresh deployment becomes OWNER,
    // unconditionally. Every registration after that is forced to
    // STOREKEEPER, unconditionally. Elevated accounts after bootstrap are
    // created only via the owner-only create_user tool.
    const userCount = await ctx.prisma.user.count();
    const role = userCount === 0 ? 'OWNER' : 'STOREKEEPER';

    const user = await createUserRecord(ctx.prisma, { email: args.email, password: args.password, role });

    const accessToken = signToken({ sub: user.id, email: args.email, role }, config.jwtSecret);

    return { ok: true, data: { accessToken, userId: user.id, email: args.email, role } };
  },
};

export default tool;
