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
    "Send a finished stock count to the owner for approval. Every material needs a counted quantity first, and on the opening count every material with stock also needs a rate (invoice number optional) — if anything is missing, say exactly which materials. Also used to resend a count the owner sent back, once it's fixed. Stock doesn't change until the owner approves.",
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
      include: { lines: { include: { material: true } } },
    });
    if (!count) {
      return { ok: false, error: 'Stock count not found', code: 'COUNT_NOT_FOUND' };
    }
    // REJECTED = sent back by the owner and fixed by the storekeeper — it can be resubmitted.
    if (count.status !== 'DRAFT' && count.status !== 'REJECTED') {
      return { ok: false, error: `Stock count ${count.number} is ${count.status}, not DRAFT`, code: 'NOT_DRAFT' };
    }
    const names = (lines: typeof count.lines) => {
      const n = lines.map((l) => l.material.name);
      return n.length > 8 ? `${n.slice(0, 8).join(', ')} and ${n.length - 8} more` : n.join(', ');
    };
    const uncounted = count.lines.filter((line) => line.countedQty === null);
    if (uncounted.length > 0) {
      return {
        ok: false,
        error: `Not counted yet: ${names(uncounted)}.`,
        code: 'INCOMPLETE_COUNT',
      };
    }
    if (count.isOpening) {
      const noRate = count.lines.filter((l) => Number(l.countedQty) > 0 && l.unitRate === null);
      if (noRate.length > 0) {
        return {
          ok: false,
          error: `Rate from the last purchase invoice still needed for: ${names(noRate)}.`,
          code: 'INCOMPLETE_COUNT',
        };
      }
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

          // Opening count: the owner is approving values, not differences.
          const openingValue = count.isOpening
            ? count.lines.reduce((sum, l) => sum + Number(l.countedQty) * Number(l.unitRate ?? 0), 0)
            : 0;
          const body = count.isOpening
            ? `Opening stock count ${updated.number}: ${count.lines.length} material(s), total value ₹${Math.round(openingValue).toLocaleString('en-IN')}. Check the rates, then approve.`
            : `Stock count ${updated.number}: ${materialsWithDifference} material(s) with a difference, total difference ₹${Math.round(totalVarianceValue).toLocaleString('en-IN')}. Waiting for your approval.`;

          const owners = await tx.user.findMany({ where: { role: 'OWNER', isActive: true } });
          for (const owner of owners) {
            await tx.notification.create({
              data: {
                userId: owner.id,
                type: 'COUNT_PENDING_APPROVAL',
                title: count.isOpening ? `Opening stock ${updated.number} needs approval` : `Stock count ${updated.number} needs approval`,
                body,
                entityType: 'StockCount',
                entityId: updated.id,
              },
            });
          }

          return { count: updated, isOpening: count.isOpening, materialsWithDifference, totalVarianceValue, openingValue };
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
