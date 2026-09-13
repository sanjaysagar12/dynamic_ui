import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

// No `rate` field, deliberately — a returned movement's rate is ALWAYS the
// material's current StockBalance.averageRate, read fresh inside the
// transaction. Omitting the field from the schema entirely (rather than
// accepting-and-ignoring it) makes it structurally impossible for a caller
// to influence the rate, per the spec.
const lineSchema = z.object({
  materialId: z.string(),
  quantity: z.number(),
});

const inputSchema = z.object({
  jobId: z.string(),
  lines: z.array(lineSchema).min(1),
  note: z.string().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'return_material',
  description:
    "Return leftover material from a job back to stock, posting one RETURN movement per line. Each movement's rate is always the material's CURRENT weighted-average rate, read fresh at call time — never caller-supplied (the input schema has no rate field at all). Rejects with NOTHING_ISSUED_FOR_MATERIAL for any line whose material was never issued to this job (no JobBomLine, or issuedQty is 0) — there's nothing to return.",
  inputSchema,
  mutates: true,
  requiredRoles: ['STOREKEEPER', 'OWNER'],
  form: {
    title: 'Return Material',
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
        label: 'Lines',
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
          { name: 'quantity', label: 'Quantity', widget: 'number', required: true },
        ],
      },
      { name: 'note', label: 'Note', widget: 'textarea', required: false },
    ],
    submitLabel: 'Return material',
  },
  handler: async (ctx, args) => {
    // Belt-and-suspenders, same convention as issue_material.ts — no reason
    // to diverge from its role set.
    if (ctx.role !== 'STOREKEEPER' && ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only a STOREKEEPER or OWNER can return material', code: 'FORBIDDEN_ROLE' };
    }

    const job = await ctx.prisma.job.findUnique({ where: { id: args.jobId } });
    if (!job) {
      return { ok: false, error: 'Job not found', code: 'JOB_NOT_FOUND' };
    }

    for (const line of args.lines) {
      if (line.quantity <= 0) {
        return { ok: false, error: 'quantity must be positive for every line', code: 'INVALID_QTY' };
      }
    }

    const bomLines = await ctx.prisma.jobBomLine.findMany({
      where: { jobId: args.jobId, materialId: { in: args.lines.map((l) => l.materialId) } },
    });
    const bomByMaterial = new Map(bomLines.map((l) => [l.materialId, l]));
    for (const line of args.lines) {
      const bomLine = bomByMaterial.get(line.materialId);
      if (!bomLine || Number(bomLine.issuedQty) <= 0) {
        return {
          ok: false,
          error: `Material ${line.materialId} was never issued to job ${job.number} — nothing to return`,
          code: 'NOTHING_ISSUED_FOR_MATERIAL',
        };
      }
    }

    try {
      const movements = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const created = [];
          for (const line of args.lines) {
            const balance = await tx.stockBalance.findUniqueOrThrow({ where: { materialId: line.materialId } });

            const movement = await tx.stockMovement.create({
              data: {
                materialId: line.materialId,
                type: 'RETURN',
                direction: 'IN',
                quantity: line.quantity,
                rate: balance.averageRate,
                value: 0,
                balanceQtyAfter: 0,
                balanceRateAfter: 0,
                balanceValueAfter: 0,
                jobId: args.jobId,
                notes: args.note,
                movementDate: new Date(),
                actorType: ctx.userId ? 'HUMAN' : 'AGENT',
                actorId: ctx.userId,
                toolName: 'return_material',
              },
            });
            created.push(movement);

            await tx.jobBomLine.update({
              where: { jobId_materialId: { jobId: args.jobId, materialId: line.materialId } },
              data: { returnedQty: { increment: line.quantity } },
            });
          }
          return created;
        },
        (movements) => ({
          entityType: 'Job',
          entityId: args.jobId,
          action: 'RETURN_MATERIAL',
          toolName: 'return_material',
          afterJson: movements,
        }),
      );

      return { ok: true, data: { jobId: args.jobId, movements } };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
