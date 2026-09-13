import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z
  .object({
    materialId: z.string().optional(),
    jobId: z.string().optional(),
    cursor: z.string().optional(),
    take: z.number().int().positive().max(200).optional(),
  })
  .refine((args) => Boolean(args.materialId) || Boolean(args.jobId), {
    message: 'At least one of materialId or jobId is required',
    path: ['materialId'],
  });

type Args = z.infer<typeof inputSchema>;

const DEFAULT_TAKE = 50;

const tool: ToolDefinition<Args> = {
  name: 'get_movement_history',
  description:
    'Get the stock movement ledger, filtered by materialId and/or jobId (at least one is required), newest first, cursor-paginated. Pass the previous response\'s nextCursor as cursor to get the next page. take defaults to 50, max 200.',
  inputSchema,
  mutates: false,
  display: {
    type: 'table',
    columns: [
      { field: 'movementDate', label: 'Date', format: 'date' },
      { field: 'type', label: 'Type', format: 'badge' },
      { field: 'quantity', label: 'Quantity', format: 'number' },
      { field: 'rate', label: 'Rate', format: 'currency' },
      { field: 'value', label: 'Value', format: 'currency' },
      { field: 'balanceQtyAfter', label: 'Balance after', format: 'number' },
    ],
  },
  handler: async (ctx, args) => {
    const take = args.take ?? DEFAULT_TAKE;

    // id is the tiebreaker (movementDate alone isn't guaranteed unique) so a
    // cursor page is stable and non-overlapping even when several movements
    // share the same movementDate.
    const movements = await ctx.prisma.stockMovement.findMany({
      where: {
        materialId: args.materialId,
        jobId: args.jobId,
      },
      orderBy: [{ movementDate: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    });

    const hasMore = movements.length > take;
    const page = hasMore ? movements.slice(0, take) : movements;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { ok: true, data: { movements: page, nextCursor } };
  },
};

export default tool;
