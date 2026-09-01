import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

// .passthrough() (not the default strip, and not .strict()) so an extra
// uom/stockType field survives into parsed args instead of being silently
// dropped by zod, or failing the whole request with a generic zod message —
// the handler below checks for it explicitly and returns the doc's specific
// IMMUTABLE_FIELD code, which .strict() alone couldn't produce.
const inputSchema = z
  .object({
    materialId: z.string(),
    name: z.string().min(1).optional(),
    minimumLevel: z.number().positive().optional(),
    hsnCode: z.string().optional(),
    gstRate: z.number().optional(),
  })
  .passthrough();

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'update_material',
  description: 'Update a material master row (name, minimumLevel, hsnCode, gstRate only — uom/stockType are immutable).',
  inputSchema,
  mutates: true,
  handler: async (ctx, args) => {
    if ('uom' in args || 'stockType' in args) {
      return {
        ok: false,
        error: 'uom and stockType cannot be changed after creation',
        code: 'IMMUTABLE_FIELD',
      };
    }

    try {
      const material = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.material.update({
            where: { id: args.materialId },
            data: {
              name: args.name,
              minimumLevel: args.minimumLevel,
              hsnCode: args.hsnCode,
              gstRate: args.gstRate,
            },
          }),
        (material) => ({
          entityType: 'Material',
          entityId: material.id,
          action: 'UPDATE_MATERIAL',
          toolName: 'update_material',
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
