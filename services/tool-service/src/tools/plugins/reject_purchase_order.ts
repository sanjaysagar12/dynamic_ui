import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  purchaseOrderId: z.string(),
  reason: z.string().min(1),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'reject_purchase_order',
  description: 'Reject a purchase order currently PENDING_APPROVAL, persisting a required reason. Owner only.',
  inputSchema,
  mutates: true,
  requiredRoles: ['OWNER'],
  form: {
    title: 'Reject Purchase Order',
    fields: [
      {
        name: 'purchaseOrderId',
        label: 'Purchase order',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_pending_approvals', valueField: 'id', labelField: 'number' },
      },
      { name: 'reason', label: 'Reason', widget: 'textarea', required: true },
    ],
    submitLabel: 'Reject',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — belt-and-suspenders for an owner-only mutation.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can reject a purchase order', code: 'FORBIDDEN_NOT_OWNER' };
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
            data: { status: 'REJECTED', rejectionReason: args.reason },
          }),
        (updated) => ({
          entityType: 'PurchaseOrder',
          entityId: updated.id,
          action: 'REJECT',
          toolName: 'reject_purchase_order',
          reason: args.reason,
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
