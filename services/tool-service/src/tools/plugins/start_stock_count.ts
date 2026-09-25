import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { nextNumber, indianFinancialYear } from '../../lib/numberSeries.js';

const inputSchema = z.object({
  countDate: z.coerce.date(),
  isOpening: z.boolean().optional(),
  materialIds: z.array(z.string()).optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'start_stock_count',
  description:
    "Start a physical stock count. Freezes the system quantity of every material (or chosen materials) at this moment so later movements don't shift it; counts can then be filled in over several days. The OPENING count at go-live is special: it happens once, before any other stock is recorded, and for each material records a rate from the last purchase invoice (invoice number optional). If an opening count is already in progress, continue that one instead of starting another.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Start Stock Count',
    fields: [
      { name: 'countDate', label: 'Count date', widget: 'date', required: true },
      { name: 'isOpening', label: 'Opening count', widget: 'checkbox', required: false, defaultValue: false },
      {
        name: 'materialIds',
        label: 'Materials (leave empty to count every active material)',
        widget: 'line_items',
        required: false,
        itemFields: [
          {
            name: 'materialId',
            label: 'Material',
            widget: 'foreign_key',
            required: true,
            foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
          },
        ],
      },
    ],
    submitLabel: 'Start count',
  },
  handler: async (ctx, args) => {
    if (args.isOpening) {
      // There is only ever one opening count, and it must come before any other stock activity:
      // its lines are frozen at zero, so a receipt or issue recorded before it would be counted twice.
      const existing = await ctx.prisma.stockCount.findFirst({
        where: { isOpening: true, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing?.status === 'APPROVED') {
        return {
          ok: false,
          error: `The opening count (${existing.number}) is already done. New materials come into stock through goods receipts.`,
          code: 'OPENING_ALREADY_DONE',
        };
      }
      if (existing) {
        return {
          ok: false,
          error: `The opening count ${existing.number} is already in progress — continue that one.`,
          code: 'OPENING_IN_PROGRESS',
        };
      }
      const anyMovement = await ctx.prisma.stockMovement.findFirst({ select: { id: true } });
      if (anyMovement) {
        return {
          ok: false,
          error: 'Stock has already been recorded in the system, so an opening count is no longer possible. Use a normal stock count.',
          code: 'OPENING_NOT_FIRST',
        };
      }
    }

    try {
      const count = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const number = await nextNumber(tx, 'CNT', indianFinancialYear(args.countDate));
          const created = await tx.stockCount.create({
            data: {
              number,
              countDate: args.countDate,
              isOpening: args.isOpening ?? false,
              countedById: ctx.userId,
            },
          });

          // Resolve the target material set, then read every one of their
          // current balances via a SINGLE query inside this same
          // transaction — this is what closes the window for a concurrent
          // movement to land between "read the balance" and "freeze it as
          // the count's system quantity." Do not split this into a
          // per-material read loop or (worse) a read before the transaction
          // opens.
          const materials = args.materialIds
            ? await tx.material.findMany({ where: { id: { in: args.materialIds } } })
            : await tx.material.findMany({ where: { isActive: true } });

          const balances = await tx.stockBalance.findMany({
            where: { materialId: { in: materials.map((m) => m.id) } },
          });
          const balanceByMaterial = new Map(balances.map((b) => [b.materialId, b]));

          const lines = await Promise.all(
            materials.map((material) =>
              tx.stockCountLine.create({
                data: {
                  stockCountId: created.id,
                  materialId: material.id,
                  systemQty: balanceByMaterial.get(material.id)?.quantity ?? 0,
                },
              }),
            ),
          );

          return { ...created, lines };
        },
        (count) => ({
          entityType: 'StockCount',
          entityId: count.id,
          action: 'CREATE',
          toolName: 'start_stock_count',
          afterJson: count,
        }),
      );

      return { ok: true, data: count };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
