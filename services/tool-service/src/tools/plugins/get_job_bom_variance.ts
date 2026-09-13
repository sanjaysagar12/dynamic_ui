import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  jobId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

interface BomVarianceRow {
  job_number: string;
  material_name: string;
  uom: string;
  bom_required: unknown;
  actually_issued: unknown;
  returned: unknown;
  net_consumed: unknown;
  variance: unknown;
  variance_pct: unknown;
}

const tool: ToolDefinition<Args> = {
  name: 'get_job_bom_variance',
  description: 'Get BOM-vs-actual variance for a job, per material — required qty vs. what was actually issued/returned, and the variance %.',
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'material_name', label: 'Material' },
      { field: 'bom_required', label: 'Required', format: 'number' },
      { field: 'actually_issued', label: 'Issued', format: 'number' },
      { field: 'returned', label: 'Returned', format: 'number' },
      { field: 'variance', label: 'Variance', format: 'number' },
    ],
  },
  handler: async (ctx, args) => {
    const job = await ctx.prisma.job.findUnique({ where: { id: args.jobId } });
    if (!job) {
      return { ok: false, error: 'Job not found', code: 'JOB_NOT_FOUND' };
    }

    // v_bom_vs_actual is keyed by job_number, not job_id — read the same
    // view the DB layer maintains rather than re-deriving this math here.
    const rows = await ctx.prisma.$queryRaw<BomVarianceRow[]>`
      SELECT * FROM v_bom_vs_actual WHERE job_number = ${job.number}
    `;

    return { ok: true, data: rows };
  },
};

export default tool;
