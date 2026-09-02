import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  purchaseOrderId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'approve_purchase_order',
  description: 'Approve a purchase order currently PENDING_APPROVAL. Owner only.',
  inputSchema,
  mutates: true,
  requiredRoles: ['OWNER'],
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — belt-and-suspenders for an owner-only mutation.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can approve a purchase order', code: 'FORBIDDEN_NOT_OWNER' };
    }

    const po = await ctx.prisma.purchaseOrder.findUnique({ where: { id: args.purchaseOrderId } });
    if (!po) {
      return { ok: false, error: 'Purchase order not found', code: 'PO_NOT_FOUND' };
    }
    if (po.status !== 'PENDING_APPROVAL') {
      return {
        ok: false,
        error: `Purchase order ${po.number} is ${po.status}, not PENDING_APPROVAL`,
        code: 'NOT_PENDING',
      };
    }

    try {
      const updated = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.purchaseOrder.update({
            where: { id: args.purchaseOrderId },
            data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
          }),
        (updated) => ({
          entityType: 'PurchaseOrder',
          entityId: updated.id,
          action: 'APPROVE',
          toolName: 'approve_purchase_order',
          beforeJson: { status: po.status },
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
