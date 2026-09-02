import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { nextNumber, indianFinancialYear } from '../../lib/numberSeries.js';

// quantity is type-checked here only (not .positive()) — the router rejects
// a schema failure as generic INVALID_ARGS before the handler ever runs, but
// the doc names INVALID_QTY specifically, so the positivity rule is enforced
// in the handler instead, where it can return that named code.
const inputSchema = z
  .object({
    customerId: z.string(),
    customerPoId: z.string().optional(),
    productDescription: z.string().min(1),
    quantity: z.number().int(),
    jobDate: z.coerce.date(),
    dueDate: z.coerce.date().optional(),
    type: z.enum(['PRODUCTION', 'SAMPLE']).optional(),
    parentJobId: z.string().optional(),
  })
  .refine((args) => args.type !== 'SAMPLE' || Boolean(args.parentJobId), {
    message: 'parentJobId is required when type is SAMPLE',
    path: ['parentJobId'],
  });

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'create_job',
  description: 'Create a new job (one release against a customer PO), auto-numbered JOB-<FY>-####.',
  inputSchema,
  mutates: true,
  form: {
    title: 'New Job',
    fields: [
      {
        name: 'customerId',
        label: 'Customer',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'name', args: { table: 'party', where: { isCustomer: true } } },
      },
      {
        name: 'customerPoId',
        label: 'Customer PO',
        widget: 'foreign_key',
        required: false,
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'number', args: { table: 'customerPo' } },
      },
      { name: 'productDescription', label: 'Product description', widget: 'textarea', required: true },
      { name: 'quantity', label: 'Quantity', widget: 'number', required: true },
      { name: 'jobDate', label: 'Job date', widget: 'date', required: true },
      { name: 'dueDate', label: 'Due date', widget: 'date', required: false },
      {
        name: 'type',
        label: 'Job type',
        widget: 'select',
        required: false,
        defaultValue: 'PRODUCTION',
        options: [
          { value: 'PRODUCTION', label: 'Production' },
          { value: 'SAMPLE', label: 'Sample' },
        ],
      },
      {
        name: 'parentJobId',
        label: 'Parent job (production run this sample precedes)',
        widget: 'foreign_key',
        required: false,
        visibleIf: { field: 'type', equals: 'SAMPLE' },
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'number', args: { table: 'job' } },
      },
    ],
    submitLabel: 'Create job',
  },
  handler: async (ctx, args) => {
    if (args.quantity <= 0) {
      return { ok: false, error: 'quantity must be a positive integer', code: 'INVALID_QTY' };
    }

    if (args.type === 'SAMPLE') {
      const parent = await ctx.prisma.job.findUnique({ where: { id: args.parentJobId! } });
      if (!parent || parent.customerId !== args.customerId) {
        return {
          ok: false,
          error: 'parentJobId must reference an existing job belonging to the same customer',
          code: 'PARENT_JOB_MISMATCH',
        };
      }
    }

    try {
      const job = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const number = await nextNumber(tx, 'JOB', indianFinancialYear(args.jobDate));
          return tx.job.create({
            data: {
              number,
              customerId: args.customerId,
              customerPoId: args.customerPoId,
              type: args.type ?? 'PRODUCTION',
              parentJobId: args.parentJobId,
              productDescription: args.productDescription,
              quantity: args.quantity,
              jobDate: args.jobDate,
              dueDate: args.dueDate,
              status: 'OPEN',
            },
          });
        },
        (job) => ({
          entityType: 'Job',
          entityId: job.id,
          action: 'CREATE_JOB',
          toolName: 'create_job',
          afterJson: job,
        }),
      );

      return { ok: true, data: job };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
