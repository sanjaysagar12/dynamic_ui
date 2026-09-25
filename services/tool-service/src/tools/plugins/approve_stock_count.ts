import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  stockCountId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'approve_stock_count',
  description:
    "OWNER ONLY. Approve a stock count that is waiting for the owner. A normal count changes stock to match what was counted: every material whose count differed gets an adjustment at its current average rate. The OPENING count instead puts every material into stock at the rate entered from its invoice — before the owner confirms, show the total value and point out any rate that looks unusual. This cannot be undone except by later counts.",
  inputSchema,
  mutates: true,
  destructive: true,
  requiredRoles: ['OWNER'],
  form: {
    title: 'Approve Stock Count',
    fields: [
      {
        name: 'stockCountId',
        label: 'Stock count',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_pending_approvals', valueField: 'id', labelField: 'number' },
      },
    ],
    submitLabel: 'Approve',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — belt-and-suspenders, same convention as
    // approve_purchase_order.ts.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can approve a stock count', code: 'FORBIDDEN_NOT_OWNER' };
    }

    const count = await ctx.prisma.stockCount.findUnique({
      where: { id: args.stockCountId },
      include: { lines: true },
    });
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
    if (count.isOpening) {
      // The opening count's lines were frozen at zero; any stock recorded since would be counted twice.
      const anyMovement = await ctx.prisma.stockMovement.findFirst({ select: { id: true } });
      if (anyMovement) {
        return {
          ok: false,
          error:
            'Stock was recorded after the opening count started, so it can no longer be approved as-is. ' +
            'Send it back so the counts can be checked against what has been received or issued since.',
          code: 'OPENING_NOT_FIRST',
        };
      }
    }

    try {
      const outcome = await withAuditedTransaction(
        ctx,
        async (tx) => {
          // ORDERING CONSTRAINT — do not reorder these two steps.
          // trg_guard_count_adjustment re-checks StockCount.status inside
          // this same transaction before allowing a COUNT_ADJUSTMENT
          // insert. The status flip below MUST commit-within-transaction
          // before the movement inserts that follow it, or the trigger
          // rejects them. See: ARCHITECTURE.md → Planned test layout →
          // Phase 1, and test/tools/physical-count.test.ts's ordering
          // regression test.
          const updated = await tx.stockCount.update({
            where: { id: args.stockCountId },
            data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
          });

          const movements = [];

          if (count.isOpening) {
            // OPENING: every material with stock goes in at the rate from its last purchase invoice.
            // trg_guard_count_submission has already refused the APPROVED flip above if any such
            // line lacks a rate, and trg_guard_count_adjustment only lets OPENING rows through for
            // an approved opening count.
            for (const line of count.lines) {
              const qty = Number(line.countedQty);
              if (!(qty > 0)) continue;
              const movement = await tx.stockMovement.create({
                data: {
                  materialId: line.materialId,
                  type: 'OPENING',
                  direction: 'IN',
                  quantity: qty,
                  rate: line.unitRate ?? 0,
                  // stamped by trg_apply_stock_movement — placeholders only
                  value: 0,
                  balanceQtyAfter: 0,
                  balanceRateAfter: 0,
                  balanceValueAfter: 0,
                  stockCountLineId: line.id,
                  movementDate: count.countDate,
                  notes: line.sourceInvoiceNo ? `Opening rate from invoice ${line.sourceInvoiceNo}` : 'Opening stock',
                  actorType: ctx.userId ? 'HUMAN' : 'AGENT',
                  actorId: ctx.userId,
                  toolName: 'approve_stock_count',
                },
              });
              movements.push(movement);
            }
            return { count: updated, isOpening: true, movements };
          }

          const differingLines = count.lines.filter((line) => Number(line.differenceQty) !== 0);
          const balances = await tx.stockBalance.findMany({
            where: { materialId: { in: differingLines.map((line) => line.materialId) } },
          });
          const rateByMaterial = new Map(balances.map((b) => [b.materialId, b.averageRate]));

          for (const line of differingLines) {
            const differenceQty = Number(line.differenceQty);
            const movement = await tx.stockMovement.create({
              data: {
                materialId: line.materialId,
                type: 'COUNT_ADJUSTMENT',
                direction: differenceQty > 0 ? 'IN' : 'OUT',
                quantity: Math.abs(differenceQty),
                rate: rateByMaterial.get(line.materialId) ?? 0,
                // value/balance*After are stamped by the trg_apply_stock_movement
                // DB trigger before insert — these placeholders are overwritten
                // regardless of what's passed here (same convention as
                // issue_material.ts/record_scrap_in.ts).
                value: 0,
                balanceQtyAfter: 0,
                balanceRateAfter: 0,
                balanceValueAfter: 0,
                stockCountLineId: line.id,
                movementDate: new Date(),
                actorType: ctx.userId ? 'HUMAN' : 'AGENT',
                actorId: ctx.userId,
                toolName: 'approve_stock_count',
              },
            });
            movements.push(movement);
          }

          return { count: updated, movements };
        },
        (outcome) => ({
          entityType: 'StockCount',
          entityId: outcome.count.id,
          action: 'APPROVE',
          toolName: 'approve_stock_count',
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
