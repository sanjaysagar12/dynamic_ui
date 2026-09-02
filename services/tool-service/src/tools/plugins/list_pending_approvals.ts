import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'list_pending_approvals',
  description: 'List everything currently awaiting OWNER approval — right now, purchase orders pending approval.',
  inputSchema,
  mutates: false,
  handler: async (ctx, _args) => {
    const purchaseOrders = await ctx.prisma.purchaseOrder.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { supplier: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });

    // TODO(batch-f): union in pending StockCount rows (status ===
    // 'PENDING_APPROVAL') once StockCount tools exist — StockCount isn't
    // built yet, so this only returns purchase orders for now.

    return { ok: true, data: { purchaseOrders } };
  },
};

export default tool;
