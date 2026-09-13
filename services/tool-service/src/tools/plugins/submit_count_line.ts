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
    "Record the counted quantity for one stock-count line. differenceQty is computed here (countedQty − systemQty), never left to a DB default. If the difference is non-zero and reasonCode is omitted, reasonCode is stored as 'UNEXPLAINED' — there is no retry/re-ask path in this tool; it never loops back to prompt for a reason. Only works while the parent StockCount is still DRAFT (NOT_DRAFT otherwise).",
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
