import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  table: z.string(),
  where: z.record(z.any()).optional(),
  orderBy: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

type Args = z.infer<typeof inputSchema>;

// TODO(phase-2): audit and add per-table ownership scoping — see migration plan Phase 2.
// This tool intentionally returns whatever `where` the caller supplies, unscoped by
// caller identity — do not add ad hoc scoping here, it would create a false sense
// that scoping is already handled when it isn't audited yet.
const tool: ToolDefinition<Args> = {
  name: 'list_rows',
  description: 'List rows from a table, with optional filtering, ordering, and a row limit.',
  inputSchema,
  mutates: false,
  handler: async (ctx, args) => {
    const delegate = (ctx.prisma as Record<string, any>)[args.table];
    if (!delegate || args.table.startsWith('$') || args.table.startsWith('_') || typeof delegate.findMany !== 'function') {
      return { ok: false, error: `Unknown table "${args.table}"`, code: 'UNKNOWN_TABLE' };
    }

    const limit = args.limit ?? 50;
    const rows = await delegate.findMany({
      where: args.where,
      orderBy: args.orderBy ? { [args.orderBy]: 'asc' } : undefined,
      take: limit,
    });

    return { ok: true, data: rows };
  },
};

export default tool;
