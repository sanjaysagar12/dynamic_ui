import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'list_settings',
  description: 'List every current system setting (for example the purchase order approval limit) and its value. Anyone can read these; only the owner can change them.',
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'key', label: 'Setting' },
      { field: 'value', label: 'Value' },
    ],
  },
  handler: async (ctx) => {
    const settings = await ctx.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return {
      ok: true,
      data: settings.map((s) => ({ key: s.key, value: s.value, description: s.description ?? undefined })),
    };
  },
};

export default tool;
