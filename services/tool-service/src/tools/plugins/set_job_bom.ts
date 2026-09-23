import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

// qtyPerPiece is type-checked here only — see create_job.ts for why the
// positivity rule lives in the handler under the named INVALID_QTY code
// instead of a zod .positive() (which the router would surface as the
// generic INVALID_ARGS before this handler ever runs).
const inputSchema = z.object({
  jobId: z.string(),
  lines: z
    .array(
      z.object({
        materialId: z.string(),
        qtyPerPiece: z.number(),
      }),
    )
    .nonempty(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'set_job_bom',
  description:
    "Enter or replace a job's bill of materials: one line per material with the quantity PER PIECE. Total needed = per piece × job quantity. Before opening this, if any number might be a total for the whole job rather than per piece, ask. Alongside the form, list every line as 'name — per piece → total' with units. Only possible before any material is issued; after that, extra material is a top-up issue. After it is saved, check the job's shortage.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Set Job BOM',
    confirmationCopy:
      'This replaces the full bill of materials for the job. Double-check every ' +
      'per-piece quantity — a wrong figure multiplies across the whole run.',
    fields: [
      {
        name: 'jobId',
        label: 'Job',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'get_job', valueField: 'id', labelField: 'number' },
      },
      {
        name: 'lines',
        label: 'BOM lines',
        widget: 'line_items',
        required: true,
        itemFields: [
          {
            name: 'materialId',
            label: 'Material',
            widget: 'foreign_key',
            required: true,
            foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
          },
          { name: 'qtyPerPiece', label: 'Qty per piece', widget: 'number', required: true },
        ],
      },
    ],
    submitLabel: 'Save BOM',
  },
  handler: async (ctx, args) => {
    const job = await ctx.prisma.job.findUnique({ where: { id: args.jobId } });
    if (!job) {
      return { ok: false, error: 'Job not found', code: 'JOB_NOT_FOUND' };
    }
    if (job.status !== 'OPEN') {
      return {
        ok: false,
        error: `Job ${job.number} is ${job.status}, not OPEN — set_job_bom only sets the initial BOM on an open job. For a rework top-up on a job already past this stage, use add_bom_line instead (not yet available).`,
        code: 'JOB_NOT_OPEN',
      };
    }

    for (const line of args.lines) {
      if (line.qtyPerPiece <= 0) {
        return { ok: false, error: 'qtyPerPiece must be positive for every line', code: 'INVALID_QTY' };
      }
    }

    const materials = await ctx.prisma.material.findMany({
      where: { id: { in: args.lines.map((l) => l.materialId) }, isActive: true },
    });
    const materialsById = new Map(materials.map((m) => [m.id, m]));
    for (const line of args.lines) {
      if (!materialsById.has(line.materialId)) {
        return { ok: false, error: `Material ${line.materialId} not found or inactive`, code: 'MATERIAL_NOT_FOUND' };
      }
    }

    try {
      const bomLines = await withAuditedTransaction(
        ctx,
        (tx) =>
          Promise.all(
            args.lines.map((line) =>
              tx.jobBomLine.upsert({
                where: { jobId_materialId: { jobId: args.jobId, materialId: line.materialId } },
                create: {
                  jobId: args.jobId,
                  materialId: line.materialId,
                  qtyPerPiece: line.qtyPerPiece,
                  requiredQty: line.qtyPerPiece * job.quantity,
                },
                update: {
                  qtyPerPiece: line.qtyPerPiece,
                  requiredQty: line.qtyPerPiece * job.quantity,
                },
              }),
            ),
          ),
        (bomLines) => ({
          entityType: 'Job',
          entityId: args.jobId,
          action: 'SET_JOB_BOM',
          toolName: 'set_job_bom',
          afterJson: bomLines,
        }),
      );

      return { ok: true, data: bomLines };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
