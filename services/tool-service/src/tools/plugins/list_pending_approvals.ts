import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Args = z.infer<typeof inputSchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const tool: ToolDefinition<Args> = {
  name: 'list_pending_approvals',
  description:
    "Everything waiting for the owner: purchase orders above the approval limit and submitted stock counts. Use it when the owner asks what needs his attention, and at the start of the day.",
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

    const stockCounts = await ctx.prisma.stockCount.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
    });

    // Flat array (not wrapped in an object) so the two kinds concat plainly
    // and the result maps directly onto this tool's own table display —
    // a stock count has no supplier/totalValue, so those columns render
    // blank for its rows.
    const now = Date.now();
    const poRows = purchaseOrders.map((po) => ({
      ...po,
      supplierName: po.supplier.name,
      ageDays: Math.floor((now - po.createdAt.getTime()) / MS_PER_DAY),
    }));
    const countRows = stockCounts.map((count) => ({
      ...count,
      supplierName: undefined,
      totalValue: undefined,
      ageDays: Math.floor((now - count.createdAt.getTime()) / MS_PER_DAY),
    }));

    return { ok: true, data: [...poRows, ...countRows] };
  },
};

export default tool;
