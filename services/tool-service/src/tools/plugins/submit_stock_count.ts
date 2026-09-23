import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  stockCountId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'submit_stock_count',
  description:
    "Send a finished stock count to the owner for approval. Every material must have a counted quantity first (and on the opening count, a rate and invoice number) — if not, list exactly what's missing. Stock doesn't change until the owner approves.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Submit Stock Count',
    fields: [
      {
        name: 'stockCountId',
        label: 'Stock count',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'number', args: { table: 'stockCount' } },
      },
    ],
    submitLabel: 'Submit count',
  },
  handler: async (ctx, args) => {
    const count = await ctx.prisma.stockCount.findUnique({
      where: { id: args.stockCountId },
      include: { lines: true },
    });
    if (!count) {
      return { ok: false, error: 'Stock count not found', code: 'COUNT_NOT_FOUND' };
    }
    if (count.status !== 'DRAFT') {
      return { ok: false, error: `Stock count ${count.number} is ${count.status}, not DRAFT`, code: 'NOT_DRAFT' };
    }
    if (count.lines.some((line) => line.countedQty === null)) {
      return {
        ok: false,
        error: `Stock count ${count.number} has at least one line with no counted quantity recorded yet`,
        code: 'INCOMPLETE_COUNT',
      };
    }

    try {
      const outcome = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const updated = await tx.stockCount.update({
            where: { id: args.stockCountId },
            data: { status: 'PENDING_APPROVAL' },
          });

          const balances = await tx.stockBalance.findMany({
            where: { materialId: { in: count.lines.map((l) => l.materialId) } },
          });
          const rateByMaterial = new Map(balances.map((b) => [b.materialId, Number(b.averageRate)]));

          const differingLines = count.lines.filter((l) => Number(l.differenceQty) !== 0);
          const materialsWithDifference = differingLines.length;
          const totalVarianceValue = differingLines.reduce(
            (sum, l) => sum + Math.abs(Number(l.differenceQty)) * (rateByMaterial.get(l.materialId) ?? 0),
            0,
          );

          const owners = await tx.user.findMany({ where: { role: 'OWNER', isActive: true } });
          for (const owner of owners) {
            await tx.notification.create({
              data: {
                userId: owner.id,
                type: 'COUNT_PENDING_APPROVAL',
                title: `Stock count ${updated.number} needs approval`,
                body: `Stock count ${updated.number}: ${materialsWithDifference} material(s) with a difference, total difference ₹${Math.round(totalVarianceValue).toLocaleString('en-IN')}. Waiting for your approval.`,
                entityType: 'StockCount',
                entityId: updated.id,
              },
            });
          }

          return { count: updated, materialsWithDifference, totalVarianceValue };
        },
        (outcome) => ({
          entityType: 'StockCount',
          entityId: outcome.count.id,
          action: 'SUBMIT',
          toolName: 'submit_stock_count',
          beforeJson: { status: count.status },
          afterJson: outcome,
        }),
      );

      return { ok: true, data: outcome };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
