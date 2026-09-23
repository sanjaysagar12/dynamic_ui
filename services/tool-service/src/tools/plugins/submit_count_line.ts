import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  stockCountLineId: z.string(),
  countedQty: z.number(),
  reasonCode: z.string().optional(),
  notes: z.string().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'submit_count_line',
  description:
    "Record what was physically counted for one material in an open count. If it differs from the system quantity, ask for a reason ONCE — spillage, extra wastage, missing, entry error, or unexplained. 'I don't know' is UNEXPLAINED: accept it and move on, never ask again and never suggest a reason. On the opening count also record the rate and invoice number from the last purchase invoice; never suggest a rate, and don't ask for reasons.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Submit Count Line',
    fields: [
      {
        name: 'stockCountLineId',
        label: 'Count line',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'id', args: { table: 'stockCountLine' } },
      },
      { name: 'countedQty', label: 'Counted quantity', widget: 'number', required: true },
      { name: 'reasonCode', label: 'Reason code', widget: 'text', required: false },
      { name: 'notes', label: 'Notes', widget: 'textarea', required: false },
    ],
    submitLabel: 'Submit count line',
  },
  handler: async (ctx, args) => {
    const line = await ctx.prisma.stockCountLine.findUnique({
      where: { id: args.stockCountLineId },
      include: { stockCount: true },
    });
    if (!line) {
      return { ok: false, error: 'Stock count line not found', code: 'LINE_NOT_FOUND' };
    }
    if (line.stockCount.status !== 'DRAFT') {
      return {
        ok: false,
        error: `Stock count ${line.stockCount.number} is ${line.stockCount.status}, not DRAFT`,
        code: 'NOT_DRAFT',
      };
    }

    const differenceQty = args.countedQty - Number(line.systemQty);
    const reasonCode = differenceQty !== 0 ? args.reasonCode ?? 'UNEXPLAINED' : args.reasonCode;

    try {
      const updated = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.stockCountLine.update({
            where: { id: args.stockCountLineId },
            data: {
              countedQty: args.countedQty,
              differenceQty,
              reasonCode,
              notes: args.notes,
            },
          }),
        (updated) => ({
          entityType: 'StockCountLine',
          entityId: updated.id,
          action: 'SUBMIT_COUNT_LINE',
          toolName: 'submit_count_line',
          beforeJson: { countedQty: line.countedQty, differenceQty: line.differenceQty, reasonCode: line.reasonCode },
          afterJson: updated,
        }),
      );

      return { ok: true, data: updated };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
