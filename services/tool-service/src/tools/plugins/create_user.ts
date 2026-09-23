import { z } from 'zod';
import { isRole, ROLES } from '@org/shared-types';
import type { UserRole } from '@prisma/client';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { findExistingUser, createUserRecord } from '../../lib/createUserAccount.js';

const inputSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.string().refine(isRole, { message: `role must be one of: ${ROLES.join(', ')}` }),
  })
  .strict();

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'create_user',
  description:
    'OWNER ONLY. Create a user account with a specific role. This is the only way to provision an account with a role other than the automatic bootstrap/STOREKEEPER default that self-registration (register) always produces.',
  inputSchema,
  mutates: true,
  destructive: false,
  requiredRoles: ['OWNER'],
  form: {
    title: 'Create User',
    fields: [
      { name: 'email', label: 'Email', widget: 'text', required: true },
      { name: 'password', label: 'Password', widget: 'text', required: true, helpText: 'At least 8 characters.' },
      {
        name: 'role',
        label: 'Role',
        widget: 'select',
        required: true,
        options: ROLES.map((role) => ({ value: role, label: role })),
      },
    ],
    submitLabel: 'Create user',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — same convention as approve_stock_count.ts and the other
    // owner-only tools.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can create a user', code: 'FORBIDDEN_NOT_OWNER' };
    }

    const existing = await findExistingUser(ctx.prisma, args.email);
    if (existing) {
      return { ok: false, error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' };
    }

    try {
      const user = await withAuditedTransaction(
        ctx,
        (tx) => createUserRecord(tx, { email: args.email, password: args.password, role: args.role as UserRole }),
        (user) => ({
          entityType: 'User',
          entityId: user.id,
          action: 'CREATE',
          toolName: 'create_user',
          afterJson: { email: user.email, role: user.role },
        }),
      );

      return { ok: true, data: { userId: user.id, email: user.email, role: user.role } };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
