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
  form: {
    title: 'New Material',
    fields: [
      {
        name: 'name',
        label: 'Material name',
        widget: 'text',
        required: true,
        helpText: 'Checked against existing materials for near-duplicates before saving.',
      },
      {
        name: 'uom',
        label: 'Unit of measure',
        widget: 'select',
        required: true,
        options: [
          { value: 'KG', label: 'Kilograms' },
          { value: 'NOS', label: 'Pieces' },
          { value: 'MTR', label: 'Metres' },
          { value: 'LTR', label: 'Litres' },
          { value: 'ROLL', label: 'Roll' },
          { value: 'SET', label: 'Set' },
        ],
      },
      {
        name: 'stockType',
        label: 'Stock type',
        widget: 'select',
        required: true,
        options: [
          { value: 'STANDING', label: 'Standing stock' },
          { value: 'PER_JOB', label: 'Per-job only' },
        ],
      },
      {
        name: 'minimumLevel',
        label: 'Minimum level',
        widget: 'number',
        required: true,
        visibleIf: { field: 'stockType', equals: 'STANDING' },
      },
      { name: 'hsnCode', label: 'HSN code', widget: 'text', required: false },
      { name: 'gstRate', label: 'GST rate (%)', widget: 'number', required: false },
      { name: 'isScrap', label: 'This is a scrap material', widget: 'checkbox', required: false, defaultValue: false },
    ],
    submitLabel: 'Create material',
  },
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
