import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { nextNumber, indianFinancialYear } from '../../lib/numberSeries.js';

const inputSchema = z.object({
  materialId: z.string(),
  buyerId: z.string().optional(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
  saleDate: z.coerce.date(),
  invoiceNo: z.string().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'record_scrap_sale',
  description:
    "Record scrap sold to a scrap buyer: quantity, rate per unit and buyer. Selling more than is recorded as collected is allowed but flagged — mention it.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Record Scrap Sale',
    fields: [
      {
        name: 'materialId',
        label: 'Scrap material',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
      },
      {
        name: 'buyerId',
        label: 'Buyer',
        widget: 'foreign_key',
        required: false,
        foreignKey: { tool: 'search_parties', valueField: 'id', labelField: 'label', args: { role: 'CUSTOMER' } },
      },
      { name: 'quantity', label: 'Quantity', widget: 'number', required: true },
      { name: 'rate', label: 'Rate', widget: 'number', required: true },
      { name: 'saleDate', label: 'Sale date', widget: 'date', required: true },
      { name: 'invoiceNo', label: 'Invoice no.', widget: 'text', required: false },
    ],
    submitLabel: 'Record scrap sale',
  },
  handler: async (ctx, args) => {
    const balance = await ctx.prisma.stockBalance.findUnique({ where: { materialId: args.materialId } });
    const warning =
      balance && args.quantity > Number(balance.quantity)
        ? `Selling ${args.quantity} exceeds the current on-hand balance of ${Number(balance.quantity)} — balance will go negative`
        : undefined;

    try {
      const outcome = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const number = await nextNumber(tx, 'SCS', indianFinancialYear(args.saleDate));

          const scrapSale = await tx.scrapSale.create({
            data: {
              number,
              buyerId: args.buyerId,
              materialId: args.materialId,
              saleDate: args.saleDate,
              quantity: args.quantity,
              rate: args.rate,
              amount: args.quantity * args.rate,
              invoiceNo: args.invoiceNo,
            },
          });

          // value/balance*After are stamped by the trg_apply_stock_movement
          // DB trigger before insert — these placeholders are overwritten
          // regardless of what's passed here (same convention as
          // record_goods_receipt.ts/issue_material.ts).
          const movement = await tx.stockMovement.create({
            data: {
              materialId: args.materialId,
              type: 'SCRAP_SALE',
              direction: 'OUT',
              quantity: args.quantity,
              rate: args.rate,
              value: 0,
              balanceQtyAfter: 0,
              balanceRateAfter: 0,
              balanceValueAfter: 0,
              scrapSaleId: scrapSale.id,
              movementDate: args.saleDate,
              actorType: ctx.userId ? 'HUMAN' : 'AGENT',
              actorId: ctx.userId,
              toolName: 'record_scrap_sale',
            },
          });

          return { scrapSale, movement };
        },
        ({ scrapSale }) => ({
          entityType: 'ScrapSale',
          entityId: scrapSale.id,
          action: 'CREATE',
          toolName: 'record_scrap_sale',
          afterJson: scrapSale,
        }),
      );

      return {
        ok: true,
        data: { scrapSale: outcome.scrapSale, movement: outcome.movement, ...(warning ? { warning } : {}) },
      };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
