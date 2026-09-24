import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { resolvePartyByName } from '../../lib/resolveParty.js';

const inputSchema = z
  .object({
    customerId: z.string().optional(),
    customerName: z.string().min(1).optional(),
    number: z.string().min(1),
    poDate: z.coerce.date().optional(),
  })
  .refine((args) => Boolean(args.customerId) !== Boolean(args.customerName), {
    message: 'Provide exactly one of customerId or customerName',
    path: ['customerId'],
  });

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'create_customer_po',
  description:
    "Record a purchase order received FROM A CUSTOMER (not one we send a supplier). The customer must already be saved — it never creates one; if they're new, add them with create_party first. If the same customer and PO number already exist, it returns the existing one — that is normal for open POs, where the same PO number carries several releases over time. Each release becomes its own job.",
  inputSchema,
  mutates: true,
  form: {
    title: 'New Customer PO',
    fields: [
      {
        name: 'customerName',
        label: 'Customer',
        widget: 'foreign_key',
        required: true,
        helpText: 'Pick the customer. Not in the list? Add them first with their GSTIN and city.',
        foreignKey: {
          tool: 'search_parties',
          valueField: 'name',
          labelField: 'label',
          allowCreate: false,
          args: { role: 'CUSTOMER' },
        },
      },
      { name: 'number', label: 'PO number', widget: 'text', required: true },
      { name: 'poDate', label: 'PO date', widget: 'date', required: false },
    ],
    submitLabel: 'Create customer PO',
  },
  handler: async (ctx, args) => {
    try {
      const customer = args.customerId
        ? await ctx.prisma.party.findUnique({ where: { id: args.customerId } })
        : await resolvePartyByName(ctx.prisma, 'customer', args.customerName!);

      if (!customer) {
        return { ok: false, error: 'No party found for the given customerId', code: 'CUSTOMER_NOT_FOUND' };
      }

      const existing = await ctx.prisma.customerPo.findFirst({
        where: { customerId: customer.id, number: args.number },
      });
      if (existing) {
        return { ok: true, data: existing };
      }

      const po = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.customerPo.create({
            data: { customerId: customer.id, number: args.number, poDate: args.poDate, status: 'OPEN' },
          }),
        (po) => ({
          entityType: 'CustomerPo',
          entityId: po.id,
          action: 'CREATE',
          toolName: 'create_customer_po',
          afterJson: po,
        }),
      );

      return { ok: true, data: po };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
