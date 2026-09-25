import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  // Omit to use the count currently being worked on (the newest DRAFT or sent-back one).
  stockCountId: z.string().optional(),
  // Only lines still missing something: a counted quantity, or (opening count) a rate.
  onlyUnfinished: z.boolean().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'list_count_lines',
  description:
    "Show the materials on a stock count with what has been entered so far: counted quantity, and on the opening count the rate and invoice number. With no count given, uses the count currently being worked on. Use it for 'what's on the count', 'what's left to count', to find the right line before recording a count, and for the owner to review a count before approving. Set onlyUnfinished to list just what's still missing.",
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'material', label: 'Material' },
      { field: 'unit', label: 'Unit' },
      { field: 'systemQty', label: 'System', format: 'number' },
      { field: 'countedQty', label: 'Counted', format: 'number' },
      { field: 'unitRate', label: 'Rate ₹', format: 'currency' },
      { field: 'sourceInvoiceNo', label: 'Invoice' },
      { field: 'reason', label: 'Reason' },
      { field: 'missing', label: 'Still needed' },
    ],
  },
  handler: async (ctx, args) => {
    const count = args.stockCountId
      ? await ctx.prisma.stockCount.findUnique({ where: { id: args.stockCountId } })
      : await ctx.prisma.stockCount.findFirst({
          where: { status: { in: ['DRAFT', 'REJECTED'] } },
          orderBy: { createdAt: 'desc' },
        });
    if (!count) {
      return { ok: false, error: 'There is no stock count in progress.', code: 'COUNT_NOT_FOUND' };
    }

    const lines = await ctx.prisma.stockCountLine.findMany({
      where: { stockCountId: count.id },
      include: { material: true },
      orderBy: { material: { name: 'asc' } },
    });

    const rows = lines
      .map((l) => {
        const counted = l.countedQty === null ? null : Number(l.countedQty);
        const missing: string[] = [];
        if (counted === null) missing.push('quantity');
        if (count.isOpening && (counted === null || counted > 0) && l.unitRate === null) missing.push('rate');
        return {
          id: l.id,
          // The label shown in form dropdowns — the material name, never an id.
          label: l.material.name,
          countNumber: count.number,
          isOpening: count.isOpening,
          status: count.status,
          material: l.material.name,
          unit: l.material.uom,
          systemQty: Number(l.systemQty),
          countedQty: counted,
          unitRate: l.unitRate === null ? null : Number(l.unitRate),
          sourceInvoiceNo: l.sourceInvoiceNo,
          reason: l.reasonCode,
          missing: missing.join(', ') || null,
        };
      })
      .filter((r) => !args.onlyUnfinished || r.missing !== null);

    return { ok: true, data: rows };
  },
};

export default tool;
