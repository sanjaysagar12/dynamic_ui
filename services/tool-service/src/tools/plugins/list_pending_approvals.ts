import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Args = z.infer<typeof inputSchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const tool: ToolDefinition<Args> = {
  name: 'list_pending_approvals',
  description: 'List everything currently awaiting OWNER approval — right now, purchase orders pending approval.',
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'number', label: 'PO number' },
      { field: 'supplierName', label: 'Supplier' },
      { field: 'totalValue', label: 'Total value', format: 'currency' },
      { field: 'createdAt', label: 'Raised', format: 'date' },
      { field: 'ageDays', label: 'Age (days)', format: 'number' },
    ],
  },
  handler: async (ctx, _args) => {
    const purchaseOrders = await ctx.prisma.purchaseOrder.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { supplier: true, lines: true },
      orderBy: { createdAt: 'asc' },
    });

    // TODO(batch-f): union in pending StockCount rows (status ===
    // 'PENDING_APPROVAL') once StockCount tools exist — StockCount isn't
    // built yet, so this only returns purchase orders for now. Flat array
    // (not wrapped in an object) so this union stays a plain concat later,
    // and so the result maps directly onto this tool's own table display.
    const now = Date.now();
    const rows = purchaseOrders.map((po) => ({
      ...po,
      supplierName: po.supplier.name,
      ageDays: Math.floor((now - po.createdAt.getTime()) / MS_PER_DAY),
    }));

    return { ok: true, data: rows };
  },
};

export default tool;
