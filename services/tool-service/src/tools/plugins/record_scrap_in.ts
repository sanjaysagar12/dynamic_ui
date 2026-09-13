import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  materialId: z.string(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative().optional(),
  jobId: z.string().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'record_scrap_in',
  description:
    "Record scrap material collected off the floor, posting one SCRAP_IN stock movement. Only valid against a material flagged isScrap: true (NOT_SCRAP_MATERIAL otherwise). rate defaults to 0 when omitted — floor scrap typically has no cost basis until it's sold.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Record Scrap In',
    fields: [
      {
        name: 'materialId',
        label: 'Scrap material',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
      },
      { name: 'quantity', label: 'Quantity', widget: 'number', required: true },
      { name: 'rate', label: 'Rate', widget: 'number', required: false, defaultValue: 0 },
      {
        name: 'jobId',
        label: 'Job (optional)',
        widget: 'foreign_key',
        required: false,
        foreignKey: { tool: 'get_job', valueField: 'id', labelField: 'number' },
      },
    ],
    submitLabel: 'Record scrap in',
  },
  handler: async (ctx, args) => {
    const material = await ctx.prisma.material.findUnique({ where: { id: args.materialId } });
    if (!material || !material.isScrap) {
      return { ok: false, error: 'Material is not flagged as scrap', code: 'NOT_SCRAP_MATERIAL' };
    }

    try {
      const movement = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.stockMovement.create({
            data: {
              materialId: args.materialId,
              type: 'SCRAP_IN',
              direction: 'IN',
              quantity: args.quantity,
              rate: args.rate ?? 0,
              // value/balance*After are stamped by the trg_apply_stock_movement
              // DB trigger before insert — these placeholders are overwritten
              // regardless of what's passed here (same convention as
              // issue_material.ts/return_material.ts).
              value: 0,
              balanceQtyAfter: 0,
              balanceRateAfter: 0,
              balanceValueAfter: 0,
              jobId: args.jobId,
              movementDate: new Date(),
              actorType: ctx.userId ? 'HUMAN' : 'AGENT',
              actorId: ctx.userId,
              toolName: 'record_scrap_in',
            },
          }),
        (movement) => ({
          entityType: 'StockMovement',
          entityId: movement.id,
          action: 'RECORD_SCRAP_IN',
          toolName: 'record_scrap_in',
          afterJson: movement,
        }),
      );

      return { ok: true, data: movement };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
