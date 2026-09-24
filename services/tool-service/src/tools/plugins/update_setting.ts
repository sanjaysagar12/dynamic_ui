import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

// Explicit allowlist of settings this tool will write — same philosophy as
// list-rows-allowlist.ts: a key not listed here is rejected (UNKNOWN_SETTING_KEY), never
// silently created as a new row. The form's `key` select (below) is generated from this same
// map, so the two can never drift apart. Add a new setting here only once something else in
// the codebase actually reads it — this file must never speculatively invent config nobody
// consumes yet.
const KNOWN_SETTINGS: Record<string, { label: string; valueType: 'number'; description: string }> = {
  'po.approval_threshold_inr': {
    label: 'PO approval limit (₹)',
    valueType: 'number',
    description: 'Purchase orders above this INR value require OWNER approval before being marked APPROVED.',
  },
};

const inputSchema = z.object({
  key: z.string(),
  value: z.string(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'update_setting',
  description:
    "OWNER ONLY. Change a system setting. The only setting available today is the key " +
    "'po.approval_threshold_inr' — the purchase order approval limit, in INR — pass that exact " +
    "string as key, never a different spelling. If the storekeeper asks for this, don't open it " +
    '— tell him only the owner changes settings.',
  inputSchema,
  mutates: true,
  requiredRoles: ['OWNER'],
  destructive: false,
  form: {
    title: 'Update Setting',
    fields: [
      {
        name: 'key',
        label: 'Setting',
        widget: 'select',
        required: true,
        options: Object.entries(KNOWN_SETTINGS).map(([value, known]) => ({ value, label: known.label })),
      },
      { name: 'value', label: 'New value', widget: 'number', required: true },
    ],
    submitLabel: 'Save setting',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate — same belt-and-suspenders pattern as
    // approve_purchase_order.ts.
    if (ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only an OWNER can change settings', code: 'FORBIDDEN_NOT_OWNER' };
    }

    const known = KNOWN_SETTINGS[args.key];
    if (!known) {
      return { ok: false, error: `"${args.key}" is not a recognized setting`, code: 'UNKNOWN_SETTING_KEY' };
    }

    if (known.valueType === 'number') {
      const parsed = Number(args.value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, error: `${args.key} must be a positive number`, code: 'INVALID_SETTING_VALUE' };
      }
    }

    try {
      const setting = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.setting.upsert({
            where: { key: args.key },
            create: {
              key: args.key,
              value: args.value,
              valueType: known.valueType,
              description: known.description,
              updatedById: ctx.userId,
            },
            update: {
              value: args.value,
              updatedById: ctx.userId,
            },
          }),
        (setting) => ({
          entityType: 'Setting',
          entityId: setting.id,
          action: 'UPDATE_SETTING',
          toolName: 'update_setting',
          afterJson: setting,
        }),
      );

      // Not the raw row: Setting has no `name`/`number`, only an internal uuid `id`, which the
      // chat agent's generic post-write success line would otherwise fall back to showing —
      // hard rule #7 (business-prompt.ts) is never show internal ids. `name` gives it a real
      // label to show instead.
      return { ok: true, data: { key: setting.key, name: known.label, value: setting.value } };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
