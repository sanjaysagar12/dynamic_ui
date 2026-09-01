import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { nextNumber } from '../../lib/numberSeries.js';
import { findMaterialsByName } from './search_materials.js';

const inputSchema = z.object({
  name: z.string().min(1),
  uom: z.enum(['KG', 'NOS', 'MTR', 'LTR', 'ROLL', 'SET']),
  stockType: z.enum(['STANDING', 'PER_JOB']),
  minimumLevel: z.number().positive().optional(),
  hsnCode: z.string().optional(),
  gstRate: z.number().optional(),
  isScrap: z.boolean().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'create_material',
  description: 'Create a new material master row, auto-numbered MAT-####.',
  inputSchema,
  mutates: true,
  handler: async (ctx, args) => {
    const suspects = await findMaterialsByName(ctx.prisma, args.name.trim());
    if (suspects.length > 0) {
      return {
        ok: false,
        error: 'A material with a very similar name already exists',
        code: 'DUPLICATE_MATERIAL_SUSPECTED',
        data: { suggestion: suspects[0] },
      };
    }

    if (args.stockType === 'STANDING' && !(args.minimumLevel && args.minimumLevel > 0)) {
      return {
        ok: false,
        error: 'STANDING materials require a positive minimumLevel',
        code: 'MISSING_MINIMUM_LEVEL',
      };
    }

    try {
      const material = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const code = await nextNumber(tx, 'MAT');
          return tx.material.create({
            data: {
              code,
              name: args.name,
              uom: args.uom,
              stockType: args.stockType,
              minimumLevel: args.minimumLevel,
              hsnCode: args.hsnCode,
              gstRate: args.gstRate,
              isScrap: args.isScrap,
            },
          });
        },
        (material) => ({
          entityType: 'Material',
          entityId: material.id,
          action: 'CREATE_MATERIAL',
          toolName: 'create_material',
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
