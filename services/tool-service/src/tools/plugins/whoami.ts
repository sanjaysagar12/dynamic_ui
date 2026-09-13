import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'whoami',
  description: 'Return the identity of the currently authenticated caller.',
  inputSchema,
  mutates: false,
  display: {
    type: 'card',
    fields: [
      { field: 'userId', label: 'User ID' },
      { field: 'email', label: 'Email' },
      { field: 'role', label: 'Role', format: 'badge' },
    ],
  },
  handler: async (ctx) => {
    return { ok: true, data: { userId: ctx.userId, email: ctx.email, role: ctx.role } };
  },
};

export default tool;
