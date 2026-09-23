import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  jobId: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'check_job_shortage',
  description:
    "For a job's BOM, show how much of each material is needed versus what is in stock, and the shortfall. Run it right after a BOM is saved and whenever the user asks what a job is short of. If anything is short, offer to raise a purchase order for exactly the shortfall.",
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
