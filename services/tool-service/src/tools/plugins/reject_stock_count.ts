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
    "OWNER ONLY. Send a submitted stock count back for recounting, with a note on what to recount. Stock doesn't change. The storekeeper needs to recount.",
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

          // The recount is the storekeeper's job, so he's the one told — not the owner who just
          // sent it back. Whoever started the count is included; owners only as a last resort so
          // the request is never lost.
          const storekeepers = await tx.user.findMany({ where: { role: 'STOREKEEPER', isActive: true } });
          const recipientIds = new Set(storekeepers.map((u) => u.id));
          if (count.countedById) recipientIds.add(count.countedById);
          if (recipientIds.size === 0) {
            const owners = await tx.user.findMany({ where: { role: 'OWNER', isActive: true } });
            owners.forEach((o) => recipientIds.add(o.id));
          }
          for (const userId of recipientIds) {
            await tx.notification.create({
              data: {
                userId,
                type: 'RECOUNT_REQUIRED',
                title: `Recount needed: ${updated.number}`,
                body: `The owner sent count ${updated.number} back: ${args.rejectionNote}. Fix the lines and send it again.`,
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
