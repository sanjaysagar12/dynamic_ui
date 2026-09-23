import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  movementId: z.string(),
  reason: z.string().min(1),
});

type Args = z.infer<typeof inputSchema>;

const OPPOSITE_DIRECTION = {
  IN: 'OUT',
  OUT: 'IN',
} as const;

const tool: ToolDefinition<Args> = {
  name: 'reverse_movement',
  description:
    "OWNER ONLY. Correct a mistaken stock movement by posting an opposite entry. The original is never edited or deleted — both stay visible. Before the owner confirms, show the material, quantity, job (if any), the date of the original and the stock balance after the reversal. Each movement can be reversed only once. If the storekeeper asks, explain that corrections are done by the owner.",
  inputSchema,
  mutates: true,
  destructive: true,
  requiredRoles: ['OWNER'],
  form: {
    title: 'Reverse Movement',
    confirmationCopy:
      'This posts a permanent correcting entry against the stock ledger — the original movement is never edited or deleted. Confirm the material, quantity, and job below before proceeding.',
    fields: [
      {
        name: 'movementId',
        label: 'Movement',
        widget: 'text',
        required: true,
        helpText: 'The stock movement id to reverse — no dedicated single-row lookup tool exists yet; find it via get_movement_history.',
      },
      { name: 'reason', label: 'Reason', widget: 'textarea', required: true },
    ],
    submitLabel: 'Reverse movement',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — belt-and-suspenders, same convention as
    // approve_purchase_order.ts/reject_purchase_order.ts. No test can
    // currently distinguish this check's absence (the router's own
    // requiredRoles gate already rejects a non-OWNER caller first over real
    // HTTP), but it stays as defense-in-depth for any non-router caller.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can reverse a movement', code: 'FORBIDDEN_NOT_OWNER' };
    }

    const original = await ctx.prisma.stockMovement.findUnique({ where: { id: args.movementId } });
    if (!original) {
      return { ok: false, error: 'Movement not found', code: 'MOVEMENT_NOT_FOUND' };
    }

    try {
      // No pre-check of original.reversedBy: relying on the @unique
      // constraint on reversalOfId and catching the violation below is what
      // makes this race-safe under concurrent reversal attempts — a
      // check-then-insert would have a window where two callers both pass
      // the check before either inserts.
      const reversal = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.stockMovement.create({
            data: {
              materialId: original.materialId,
              type: 'REVERSAL',
              direction: OPPOSITE_DIRECTION[original.direction],
              quantity: original.quantity,
              rate: original.rate,
              // value/balance*After are stamped by the trg_apply_stock_movement
              // DB trigger before insert — these placeholders are overwritten
              // regardless of what's passed here (same convention as
              // record_goods_receipt.ts/issue_material.ts).
              value: 0,
              balanceQtyAfter: 0,
              balanceRateAfter: 0,
              balanceValueAfter: 0,
              jobId: original.jobId,
              reversalOfId: original.id,
              notes: args.reason,
              movementDate: new Date(),
              actorType: ctx.userId ? 'HUMAN' : 'AGENT',
              actorId: ctx.userId,
              toolName: 'reverse_movement',
            },
          }),
        (reversal) => ({
          entityType: 'StockMovement',
          entityId: reversal.id,
          action: 'REVERSE',
          toolName: 'reverse_movement',
          reason: args.reason,
          beforeJson: { reversalOfId: original.id },
          afterJson: reversal,
        }),
      );

      return { ok: true, data: reversal };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
