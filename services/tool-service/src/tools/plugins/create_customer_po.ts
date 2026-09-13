import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { resolveOrCreateByName } from '../../lib/resolveOrCreateByName.js';

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
    'Create a customer PO (the umbrella PO a job release is raised against). Looks up or creates the customer by name if customerName is given. IMPORTANT: a repeated call with the same customer and the same number returns the EXISTING PO rather than creating a duplicate — this is a lookup-or-create, not a duplicate-rejection, so treat a second call that returns an already-existing PO as a success, not a failed create.',
  inputSchema,
  mutates: true,
  form: {
    title: 'New Customer PO',
    fields: [
      {
        name: 'customerName',
        label: 'Customer name',
        widget: 'foreign_key',
        required: true,
        helpText: 'Pick an existing customer, or type a new name — it is resolved-or-created by name, not by id.',
        foreignKey: {
          tool: 'list_rows',
          valueField: 'name',
          labelField: 'name',
          allowCreate: true,
          args: { table: 'party', where: { isCustomer: true } },
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
        : await ctx.prisma.$transaction((tx) => resolveOrCreateByName(tx, 'customer', args.customerName!));

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
