import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const inputSchema = z.object({
  jobId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'close_job',
  description:
    "Close a job once production is finished. Fixes the job's material cost (value issued minus value returned) and shows issued vs returned vs BOM for every material. BEFORE opening this, if the job had material issued, ask the user in chat whether anything came back — and record returns first. Never close assuming nothing was returned.",
  inputSchema,
  mutates: true,
  requiredRoles: ['STOREKEEPER', 'OWNER'],
  form: {
    title: 'Close Job',
    fields: [
      {
        name: 'jobId',
        label: 'Job',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'get_job', valueField: 'id', labelField: 'number' },
      },
    ],
    submitLabel: 'Close job',
  },
  handler: async (ctx, args) => {
    // Belt-and-suspenders, same convention as issue_material.ts/return_material.ts
    // — the source doc doesn't say either way, so this defaults open to the
    // same STOREKEEPER + OWNER set rather than restricting to OWNER only.
    if (ctx.role !== 'STOREKEEPER' && ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only a STOREKEEPER or OWNER can close a job', code: 'FORBIDDEN_ROLE' };
    }

    const job = await ctx.prisma.job.findUnique({ where: { id: args.jobId } });
    if (!job) {
      return { ok: false, error: 'Job not found', code: 'JOB_NOT_FOUND' };
    }

    try {
      const outcome = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const [issueAgg, returnAgg] = await Promise.all([
            tx.stockMovement.aggregate({ where: { jobId: args.jobId, type: 'ISSUE' }, _sum: { value: true } }),
            tx.stockMovement.aggregate({ where: { jobId: args.jobId, type: 'RETURN' }, _sum: { value: true } }),
          ]);
          const issuedValue = Number(issueAgg._sum.value ?? 0);
          const returnedValue = Number(returnAgg._sum.value ?? 0);
          const materialCost = issuedValue - returnedValue;

          const bomLines = await tx.jobBomLine.findMany({
            where: { jobId: args.jobId },
            include: { material: true },
          });
          const outstanding = bomLines.map((l) => ({
            materialId: l.materialId,
            materialName: l.material.name,
            requiredQty: Number(l.requiredQty),
            issuedQty: Number(l.issuedQty),
            returnedQty: Number(l.returnedQty),
            outstandingQty: Number(l.issuedQty) - Number(l.returnedQty),
          }));

          const updated = await tx.job.update({
            where: { id: args.jobId },
            data: { status: 'CLOSED', closedAt: new Date(), materialCost },
          });

          return { job: updated, outstanding };
        },
        (outcome) => ({
          entityType: 'Job',
          entityId: outcome.job.id,
          action: 'CLOSE_JOB',
          toolName: 'close_job',
          beforeJson: { status: job.status },
          afterJson: { status: outcome.job.status, materialCost: outcome.job.materialCost },
        }),
      );

      return { ok: true, data: outcome };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
