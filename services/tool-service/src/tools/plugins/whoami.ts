import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'whoami',
  description: 'Return the identity of the currently authenticated caller.',
  inputSchema,
  mutates: false,
  handler: async (ctx) => {
    return { ok: true, data: { userId: ctx.userId, email: ctx.email, role: ctx.role } };
  },
};

export default tool;
