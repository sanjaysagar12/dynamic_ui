import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { nextNumber } from '../../lib/numberSeries.js';
import {
  cleanPartyName,
  findSimilarParties,
  isValidGstin,
  normalizeGstin,
  partyNameKey,
  publicParty,
} from '../../lib/partyName.js';

const inputSchema = z.object({
  name: z.string().min(2),
  role: z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']),
  gstin: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  // Set only after the user has seen the similar names and said this is a different business.
  confirmNotDuplicate: z.boolean().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'create_party',
  description:
    "Add a new supplier or customer (or a business that is both). Needs the business NAME ONLY — put the city in the City field, never in the name: 'Sundaram Ferrites, Chennai' is name 'Sundaram Ferrites' + city 'Chennai'. GSTIN is optional but should be captured when the user has it; it is checked for the correct format. Before opening this, search_parties for the name. If the business already exists as the other type (a customer who now also supplies), this adds the new type instead of creating a second entry. If a similar name exists, the user is shown it and must confirm this is a different business. Scrap buyers are customers.",
  inputSchema,
  mutates: true,
  requiredRoles: ['STOREKEEPER', 'OWNER'],
  form: {
    title: 'New supplier / customer',
    fields: [
      { name: 'name', label: 'Business name', widget: 'text', required: true, helpText: 'Name only — no city. e.g. Sundaram Ferrites' },
      {
        name: 'role',
        label: 'Type',
        widget: 'select',
        required: true,
        options: [
          { value: 'SUPPLIER', label: 'Supplier (we buy from them)' },
          { value: 'CUSTOMER', label: 'Customer (they buy from us, incl. scrap buyers)' },
          { value: 'BOTH', label: 'Both' },
        ],
      },
      { name: 'gstin', label: 'GSTIN', widget: 'text', required: false, helpText: '15 characters, e.g. 33AAACS1234K1Z2' },
      { name: 'city', label: 'City', widget: 'text', required: false },
      { name: 'state', label: 'State', widget: 'text', required: false },
      { name: 'addressLine', label: 'Address', widget: 'textarea', required: false },
      { name: 'pincode', label: 'Pincode', widget: 'text', required: false },
      { name: 'phone', label: 'Phone', widget: 'text', required: false },
      { name: 'email', label: 'Email', widget: 'text', required: false },
      {
        name: 'confirmNotDuplicate',
        label: 'This is a different business from the similar names shown',
        widget: 'checkbox',
        required: false,
        helpText: 'Tick only if you were warned about a similar name and you are sure this is not the same business.',
      },
    ],
    submitLabel: 'Add',
  },
  handler: async (ctx, args) => {
    try {
      const name = cleanPartyName(args.name);
      const nameKey = partyNameKey(name);
      if (nameKey.length < 2) {
        return { ok: false, error: 'Please enter the business name.', code: 'INVALID_NAME' };
      }

      const gstin = normalizeGstin(args.gstin);
      if (gstin && !isValidGstin(gstin)) {
        return {
          ok: false,
          error: `"${args.gstin}" doesn't look like a GSTIN. It should be 15 characters, like 33AAACS1234K1Z2.`,
          code: 'INVALID_GSTIN',
        };
      }

      const wantsSupplier = args.role !== 'CUSTOMER';
      const wantsCustomer = args.role !== 'SUPPLIER';

      // 1. Same GSTIN = same business, whatever the name says.
      const byGstin = gstin ? await ctx.prisma.party.findUnique({ where: { gstin } }) : null;
      // 2. Same normalized name = same business.
      const byName = byGstin ?? (await ctx.prisma.party.findUnique({ where: { nameKey } }));

      if (byName) {
        if (!byName.isActive) {
          return {
            ok: false,
            error: `${byName.name} already exists but was deactivated. Ask the owner to reactivate it rather than adding it again.`,
            code: 'PARTY_INACTIVE',
          };
        }
        const missingSupplier = wantsSupplier && !byName.isSupplier;
        const missingCustomer = wantsCustomer && !byName.isCustomer;
        if (!missingSupplier && !missingCustomer) {
          return {
            ok: false,
            error: `${byName.name}${byName.city ? ` (${byName.city})` : ''} is already saved${byGstin && byGstin.name !== name ? ' with this GSTIN' : ''}. No need to add them again.`,
            code: 'PARTY_EXISTS',
          };
        }
        // Existing business, new role (e.g. a customer who now also supplies): add the role.
        const updated = await withAuditedTransaction(
          ctx,
          (tx) =>
            tx.party.update({
              where: { id: byName.id },
              data: {
                ...(missingSupplier ? { isSupplier: true } : {}),
                ...(missingCustomer ? { isCustomer: true } : {}),
                // fill in details only where they were blank — never overwrite
                ...(gstin && !byName.gstin ? { gstin } : {}),
                ...(args.city && !byName.city ? { city: args.city.trim() } : {}),
                ...(args.state && !byName.state ? { state: args.state.trim() } : {}),
                ...(args.addressLine && !byName.addressLine ? { addressLine: args.addressLine.trim() } : {}),
                ...(args.pincode && !byName.pincode ? { pincode: args.pincode.trim() } : {}),
                ...(args.phone && !byName.phone ? { phone: args.phone.trim() } : {}),
                ...(args.email && !byName.email ? { email: args.email.trim() } : {}),
              },
            }),
          (p) => ({
            entityType: 'Party',
            entityId: p.id,
            action: 'UPDATE',
            toolName: 'create_party',
            reason: 'Existing business given an additional type',
            beforeJson: byName,
            afterJson: p,
          }),
        );
        return { ok: true, data: { ...publicParty(updated), outcome: 'TYPE_ADDED' } };
      }

      // 3. Similar name — probably the same business spelled differently. Ask first.
      if (!args.confirmNotDuplicate) {
        const similar = await findSimilarParties(ctx.prisma, nameKey);
        if (similar.length > 0) {
          const list = similar
            .slice(0, 5)
            .map((p) => `${p.name}${p.city ? ` (${p.city})` : ''}`)
            .join(', ');
          return {
            ok: false,
            error: `Similar name already saved: ${list}. If "${name}" is a different business, tick the "different business" box and add again.`,
            code: 'SIMILAR_PARTY_EXISTS',
          };
        }
      }

      const created = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const code = await nextNumber(tx, 'PTY');
          return tx.party.create({
            data: {
              code,
              name,
              nameKey,
              isSupplier: wantsSupplier,
              isCustomer: wantsCustomer,
              gstin,
              addressLine: args.addressLine?.trim() || null,
              city: args.city?.trim() || null,
              state: args.state?.trim() || null,
              pincode: args.pincode?.trim() || null,
              phone: args.phone?.trim() || null,
              email: args.email?.trim() || null,
            },
          });
        },
        (p) => ({
          entityType: 'Party',
          entityId: p.id,
          action: 'CREATE',
          toolName: 'create_party',
          afterJson: p,
        }),
      );

      return { ok: true, data: { ...publicParty(created), outcome: 'CREATED' } };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
