import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  materialId: z.string(),
  supplierId: z.string().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'get_purchase_price_history',
  description:
    "Get a material's purchase rate history from recorded goods receipts, most recent first — optionally filtered to a single supplier. Useful for suggesting a rate when create_purchase_order rejects a line for MISSING_RATE.",
  inputSchema,
  mutates: false,
  display: {
    type: 'chart',
    chartType: 'line',
    xField: 'receiptDate',
    yField: 'rate',
    seriesField: 'supplierName',
    title: 'Purchase rate over time',
  },
  handler: async (ctx, args) => {
    const lines = await ctx.prisma.goodsReceiptLine.findMany({
      where: {
        materialId: args.materialId,
        goodsReceipt: args.supplierId ? { supplierId: args.supplierId } : undefined,
      },
      include: { goodsReceipt: { include: { supplier: true } } },
      orderBy: { goodsReceipt: { receiptDate: 'desc' } },
    });

    const history = lines.map((line) => ({
      rate: line.rate,
      receiptDate: line.goodsReceipt.receiptDate,
      grnNumber: line.goodsReceipt.number,
      supplierId: line.goodsReceipt.supplierId,
      supplierName: line.goodsReceipt.supplier.name,
      acceptedQty: line.acceptedQty,
      rejectedQty: line.rejectedQty,
    }));

    return { ok: true, data: history };
  },
};

export default tool;
