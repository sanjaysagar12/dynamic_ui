import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  jobId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

interface JobMaterialCostRow {
  issued_value: unknown;
  returned_value: unknown;
  net_material_cost: unknown;
  material_cost_per_piece: unknown;
}

const tool: ToolDefinition<Args> = {
  name: 'get_job',
  description: "Get a job's full detail — its BOM lines (with material info) and its running material-cost summary (issued − returned value, from the ledger).",
  inputSchema,
  mutates: false,
  display: {
    type: 'card',
    fields: [
      { field: 'number', label: 'Job number' },
      { field: 'productDescription', label: 'Product' },
      { field: 'quantity', label: 'Quantity', format: 'number' },
      { field: 'status', label: 'Status', format: 'badge' },
      { field: 'materialCost', label: 'Material cost', format: 'currency' },
    ],
    subTable: {
      field: 'bomLines',
      title: 'BOM lines',
      columns: [
        { field: 'material.name', label: 'Material' },
        { field: 'requiredQty', label: 'Required', format: 'number' },
        { field: 'issuedQty', label: 'Issued', format: 'number' },
        { field: 'returnedQty', label: 'Returned', format: 'number' },
      ],
    },
  },
  handler: async (ctx, args) => {
    const job = await ctx.prisma.job.findUnique({
      where: { id: args.jobId },
      include: { bomLines: { include: { material: true } } },
    });
    if (!job) {
      return { ok: false, error: 'Job not found', code: 'JOB_NOT_FOUND' };
    }

    // Read the same v_job_material_cost view the DB layer already maintains
    // rather than re-deriving issued/returned/net cost from StockMovement
    // here — so the tool and the view's math can never drift apart.
    const costRows = await ctx.prisma.$queryRaw<JobMaterialCostRow[]>`
      SELECT issued_value, returned_value, net_material_cost, material_cost_per_piece
      FROM v_job_material_cost
      WHERE job_id = ${args.jobId}
    `;

    return {
      ok: true,
      data: {
        ...job,
        materialCostSummary: costRows[0] ?? null,
      },
    };
  },
};

export default tool;
