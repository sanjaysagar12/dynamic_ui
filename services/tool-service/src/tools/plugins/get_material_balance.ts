import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  materialIds: z.array(z.string()).min(1),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'get_material_balance',
  description: 'Get current stock balance for one or more materials.',
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'material.name', label: 'Material' },
      { field: 'material.uom', label: 'UoM' },
      { field: 'quantity', label: 'Quantity', format: 'number' },
      { field: 'averageRate', label: 'Avg. rate', format: 'currency' },
      { field: 'stockValue', label: 'Value', format: 'currency' },
    ],
  },
  handler: async (ctx, args) => {
    const balances = await ctx.prisma.stockBalance.findMany({
      where: { materialId: { in: args.materialIds } },
      include: { material: true },
    });

    return { ok: true, data: balances };
  },
};

export default tool;
