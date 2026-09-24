import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import {
  cleanPartyName,
  findSimilarParties,
  isValidGstin,
  normalizeGstin,
  partyNameKey,
  publicParty,
} from '../../lib/partyName.js';

const inputSchema = z.object({
  partyId: z.string(),
  name: z.string().min(2).optional(),
  gstin: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  // Types can only be ADDED. Removing one would orphan the history (POs, jobs) under it.
  addRole: z.enum(['SUPPLIER', 'CUSTOMER']).optional(),
  confirmNotDuplicate: z.boolean().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'update_party',
  description:
    "Change a supplier's or customer's details: name, GSTIN, city, state, address, pincode, phone, email — or mark an existing supplier as also a customer (or the reverse). Only the fields given are changed. Use it to fix a name that has the city folded into it ('Sundaram Ferrites, Chennai' → name 'Sundaram Ferrites', city 'Chennai'), or to add a GSTIN that wasn't captured. A type can be added but never removed.",
  inputSchema,
  mutates: true,
  requiredRoles: ['STOREKEEPER', 'OWNER'],
  form: {
    title: 'Edit supplier / customer',
    fields: [
      {
        name: 'partyId',
        label: 'Supplier / customer',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'search_parties', valueField: 'id', labelField: 'label', args: { role: 'ANY' } },
      },
      { name: 'name', label: 'Business name', widget: 'text', required: false, helpText: 'Name only — no city.' },
      { name: 'gstin', label: 'GSTIN', widget: 'text', required: false },
      { name: 'city', label: 'City', widget: 'text', required: false },
      { name: 'state', label: 'State', widget: 'text', required: false },
      { name: 'addressLine', label: 'Address', widget: 'textarea', required: false },
      { name: 'pincode', label: 'Pincode', widget: 'text', required: false },
      { name: 'phone', label: 'Phone', widget: 'text', required: false },
      { name: 'email', label: 'Email', widget: 'text', required: false },
      {
        name: 'addRole',
        label: 'Also mark as',
        widget: 'select',
        required: false,
        options: [
          { value: 'SUPPLIER', label: 'Supplier' },
          { value: 'CUSTOMER', label: 'Customer' },
        ],
      },
      {
        name: 'confirmNotDuplicate',
        label: 'The new name is a different business from the similar names shown',
        widget: 'checkbox',
        required: false,
      },
    ],
    submitLabel: 'Save changes',
  },
  handler: async (ctx, args) => {
    try {
      const before = await ctx.prisma.party.findUnique({ where: { id: args.partyId } });
      if (!before) {
        return { ok: false, error: "Couldn't find that supplier or customer.", code: 'PARTY_NOT_FOUND' };
      }

      const data: Record<string, unknown> = {};

      if (args.name !== undefined) {
        const name = cleanPartyName(args.name);
        const nameKey = partyNameKey(name);
        if (nameKey !== before.nameKey) {
          const clash = await ctx.prisma.party.findUnique({ where: { nameKey } });
          if (clash && clash.id !== before.id) {
            return {
              ok: false,
              error: `${clash.name} is already saved as a separate entry. These look like the same business — tell the owner so the two can be merged rather than renaming one to match.`,
              code: 'DUPLICATE_PARTY',
            };
          }
          if (!args.confirmNotDuplicate) {
            const similar = await findSimilarParties(ctx.prisma, nameKey, before.id);
            if (similar.length > 0) {
              return {
                ok: false,
                error: `Similar name already saved: ${similar.map((p) => p.name).join(', ')}. If this is a different business, tick the box and save again.`,
                code: 'SIMILAR_PARTY_EXISTS',
              };
            }
          }
        }
        data.name = name;
        data.nameKey = nameKey;
      }

      if (args.gstin !== undefined) {
        const gstin = normalizeGstin(args.gstin);
        if (gstin && !isValidGstin(gstin)) {
          return {
            ok: false,
            error: `"${args.gstin}" doesn't look like a GSTIN. It should be 15 characters, like 33AAACS1234K1Z2.`,
            code: 'INVALID_GSTIN',
          };
        }
        if (gstin) {
          const clash = await ctx.prisma.party.findUnique({ where: { gstin } });
          if (clash && clash.id !== before.id) {
            return { ok: false, error: `That GSTIN is already saved for ${clash.name}.`, code: 'DUPLICATE_GSTIN' };
          }
        }
        data.gstin = gstin;
      }

      for (const f of ['addressLine', 'city', 'state', 'pincode', 'phone', 'email'] as const) {
        if (args[f] !== undefined) data[f] = args[f]?.trim() || null;
      }
      if (args.addRole === 'SUPPLIER') data.isSupplier = true;
      if (args.addRole === 'CUSTOMER') data.isCustomer = true;

      if (Object.keys(data).length === 0) {
        return { ok: false, error: 'Nothing to change — fill in at least one field.', code: 'NO_CHANGES' };
      }

      const updated = await withAuditedTransaction(
        ctx,
        (tx) => tx.party.update({ where: { id: before.id }, data }),
        (p) => ({
          entityType: 'Party',
          entityId: p.id,
          action: 'UPDATE',
          toolName: 'update_party',
          beforeJson: before,
          afterJson: p,
        }),
      );
      return { ok: true, data: publicParty(updated) };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
