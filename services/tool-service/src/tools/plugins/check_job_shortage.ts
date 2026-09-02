import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  jobId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'check_job_shortage',
  description:
    "Compute per-material stock shortfall (requiredQty − on-hand, floored at 0) for a job's current BOM. The orchestrator should call this automatically right after a successful set_job_bom, and proactively suggest raising a purchase order (create_purchase_order, not yet available) for any material with a nonzero shortfall.",
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'materialName', label: 'Material' },
      { field: 'required', label: 'Required', format: 'number' },
      { field: 'onHand', label: 'On hand', format: 'number' },
      { field: 'shortfall', label: 'Shortfall', format: 'number' },
    ],
    highlightIf: { field: 'shortfall', op: 'gt', value: 0 },
  },
  handler: async (ctx, args) => {
    const bomLines = await ctx.prisma.jobBomLine.findMany({
      where: { jobId: args.jobId },
      include: { material: { include: { balance: true } } },
    });

    const shortages = bomLines.map((line) => {
      const required = Number(line.requiredQty);
      const onHand = Number(line.material.balance?.quantity ?? 0);
      return {
        materialId: line.materialId,
        materialName: line.material.name,
        required,
        onHand,
        shortfall: Math.max(0, required - onHand),
      };
    });

    return { ok: true, data: shortages };
  },
};

export default tool;
