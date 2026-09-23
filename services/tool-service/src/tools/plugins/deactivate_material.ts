import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  materialId: z.string(),
  reason: z.string().min(1),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'deactivate_material',
  description:
    "Stop using a material. It is never deleted, just hidden from new use, and history stays. Only possible when its stock is zero; if there is stock, say so and explain it must be used, returned or counted to zero first.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Deactivate Material',
    fields: [
      {
        name: 'materialId',
        label: 'Material',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
      },
      { name: 'reason', label: 'Reason', widget: 'textarea', required: true },
    ],
    submitLabel: 'Deactivate',
  },
  handler: async (ctx, args) => {
    const balance = await ctx.prisma.stockBalance.findUnique({ where: { materialId: args.materialId } });
    if (balance && Number(balance.quantity) !== 0) {
      return {
        ok: false,
        error: 'Material still has stock on hand and cannot be deactivated',
        code: 'MATERIAL_HAS_STOCK',
      };
    }

    try {
      const material = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.material.update({
            where: { id: args.materialId },
            data: { isActive: false },
          }),
        (material) => ({
          entityType: 'Material',
          entityId: material.id,
          action: 'DEACTIVATE_MATERIAL',
          toolName: 'deactivate_material',
          reason: args.reason,
          afterJson: material,
        }),
      );

      return { ok: true, data: material };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
