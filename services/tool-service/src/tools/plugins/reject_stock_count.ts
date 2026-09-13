import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  stockCountId: z.string(),
  rejectionNote: z.string().min(1),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'reject_stock_count',
  description:
    'Reject a stock count currently PENDING_APPROVAL, persisting a required rejectionNote. Owner only. No movements are posted — the count moves to REJECTED and every active OWNER is notified (RECOUNT_REQUIRED) that a fresh count is needed.',
  inputSchema,
  mutates: true,
  requiredRoles: ['OWNER'],
  form: {
    title: 'Reject Stock Count',
    fields: [
      {
        name: 'stockCountId',
        label: 'Stock count',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_pending_approvals', valueField: 'id', labelField: 'number' },
      },
      { name: 'rejectionNote', label: 'Rejection note', widget: 'textarea', required: true },
    ],
    submitLabel: 'Reject',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — belt-and-suspenders, same convention as
    // reject_purchase_order.ts.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can reject a stock count', code: 'FORBIDDEN_NOT_OWNER' };
    }

    const count = await ctx.prisma.stockCount.findUnique({ where: { id: args.stockCountId } });
    if (!count) {
      return { ok: false, error: 'Stock count not found', code: 'COUNT_NOT_FOUND' };
    }
    if (count.status !== 'PENDING_APPROVAL') {
      return {
        ok: false,
        error: `Stock count ${count.number} is ${count.status}, not PENDING_APPROVAL`,
        code: 'NOT_PENDING',
      };
    }

    try {
      const updated = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const updated = await tx.stockCount.update({
            where: { id: args.stockCountId },
            data: { status: 'REJECTED', rejectionNote: args.rejectionNote },
          });

          const owners = await tx.user.findMany({ where: { role: 'OWNER', isActive: true } });
          for (const owner of owners) {
            await tx.notification.create({
              data: {
                userId: owner.id,
                type: 'RECOUNT_REQUIRED',
                title: `Stock count ${updated.number} rejected — recount required`,
                body: `Stock count ${updated.number} was rejected: ${args.rejectionNote}`,
                entityType: 'StockCount',
                entityId: updated.id,
              },
            });
          }

          return updated;
        },
        (updated) => ({
          entityType: 'StockCount',
          entityId: updated.id,
          action: 'REJECT',
          toolName: 'reject_stock_count',
          reason: args.rejectionNote,
          beforeJson: { status: count.status },
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
