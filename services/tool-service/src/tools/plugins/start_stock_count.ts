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
    'Start a physical stock count: creates a DRAFT StockCount and one StockCountLine per target material (materialIds if given, else every active material), each with systemQty FROZEN to that material\'s current StockBalance.quantity, read inside the same transaction as the insert — a physical count against a system quantity that could shift underneath it defeats the whole point of a count. countedQty starts unset (null) on every line until submit_count_line records it.',
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
