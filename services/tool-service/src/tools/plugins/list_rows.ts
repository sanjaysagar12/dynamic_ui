import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { LIST_ROWS_ALLOWLIST } from '../list-rows-allowlist.js';

const inputSchema = z.object({
  table: z.string(),
  where: z.record(z.any()).optional(),
  orderBy: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

type Args = z.infer<typeof inputSchema>;

// Generated from the allowlist itself (at module-load time, i.e. once, when
// the registry imports this plugin) so the description surfaced via
// GET /tools can never drift out of sync with what the handler actually
// permits — no hand-typed table list to go stale.
const ALLOWED_TABLES = Object.keys(LIST_ROWS_ALLOWLIST).sort();

// TODO(phase-2): audit and add per-table, per-row ownership scoping — see
// migration plan Phase 2. This tool intentionally returns whatever `where`
// the caller supplies, unscoped by caller identity — do not add ad hoc
// scoping here, it would create a false sense that scoping is already
// handled when it isn't audited yet. Table/column access itself IS scoped,
// by LIST_ROWS_ALLOWLIST (../list-rows-allowlist.ts) — that's a narrower,
// separate fix (arbitrary table/column read) from row-level scoping, which
// remains this TODO's open gap.
const tool: ToolDefinition<Args> = {
  name: 'list_rows',
  description:
    `Generic list of rows from a fixed set of tables — a last resort, prefer the purpose-built tools when one exists. Only these tables can be read through this tool: ${ALLOWED_TABLES.join(', ')}. Any other table — including users, settings, lots, audit events, notifications and attachments — is refused outright.`,
  inputSchema,
  mutates: false,
  // The one tool whose display genuinely can't be authored in advance —
  // `table` is a runtime arg, so there's no fixed column set. Empty columns
  // signal the frontend to derive them from the first returned row's keys
  // at render time; this fallback is specific to this tool, not a general
  // display-spec behavior other tools should rely on.
  display: { type: 'table', columns: [] },
  handler: async (ctx, args) => {
    const tableSpec = LIST_ROWS_ALLOWLIST[args.table];
    const delegate = (ctx.prisma as Record<string, any>)[args.table];
    if (!tableSpec || !delegate || typeof delegate.findMany !== 'function') {
      return { ok: false, error: `Table "${args.table}" is not allowed for list_rows`, code: 'TABLE_NOT_ALLOWED' };
    }

    if (args.where) {
      const badWhereKey = Object.keys(args.where).find((key) => !(key in tableSpec.select));
      if (badWhereKey) {
        return {
          ok: false,
          error: `Field "${badWhereKey}" is not allowed in "where" for table "${args.table}"`,
          code: 'FIELD_NOT_ALLOWED',
        };
      }
    }

    if (args.orderBy && !(args.orderBy in tableSpec.select)) {
      return {
        ok: false,
        error: `Field "${args.orderBy}" is not allowed in "orderBy" for table "${args.table}"`,
        code: 'FIELD_NOT_ALLOWED',
      };
    }

    const limit = args.limit ?? 50;
    const rows = await delegate.findMany({
      select: tableSpec.select,
      where: args.where,
      orderBy: args.orderBy ? { [args.orderBy]: 'asc' } : undefined,
      take: limit,
    });

    return { ok: true, data: rows };
  },
};

export default tool;
