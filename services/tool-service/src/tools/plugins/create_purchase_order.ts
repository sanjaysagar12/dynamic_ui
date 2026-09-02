import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { resolveOrCreateByName } from '../../lib/resolveOrCreateByName.js';
import { nextNumber, indianFinancialYear } from '../../lib/numberSeries.js';

// rate is optional here only so a line missing it can be reported back as
// the named MISSING_RATE code rather than a generic 400 from zod — see
// create_job.ts for the same reasoning applied to INVALID_QTY.
const lineSchema = z.object({
  materialId: z.string(),
  quantity: z.number(),
  rate: z.number().optional(),
  hsnCode: z.string().optional(),
  gstRate: z.number().optional(),
});

const inputSchema = z
  .object({
    supplierId: z.string().optional(),
    supplierName: z.string().min(1).optional(),
    lines: z.array(lineSchema),
    expectedDate: z.coerce.date().optional(),
    triggeredByJobId: z.string().optional(),
  })
  .refine((args) => Boolean(args.supplierId) !== Boolean(args.supplierName), {
    message: 'Provide exactly one of supplierId or supplierName',
    path: ['supplierId'],
  });

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'create_purchase_order',
  description:
    'Create a purchase order. Looks up or creates the supplier by name if supplierName is given. Every line MUST carry an explicit rate — this tool NEVER defaults a missing rate to a past receipt rate; if any line is missing rate it fails with MISSING_RATE and inserts nothing, and the orchestrator should ask the user or call get_purchase_price_history and retry with an explicit rate. Automatically goes to PENDING_APPROVAL (and notifies every OWNER) when the computed totalValue exceeds the configured po.approval_threshold_inr Setting, otherwise it is APPROVED immediately.',
  inputSchema,
  mutates: true,
  form: {
    title: 'New Purchase Order',
    fields: [
      {
        name: 'supplierName',
        label: 'Supplier name',
        widget: 'foreign_key',
        required: true,
        helpText: 'Pick an existing supplier, or type a new name — it is resolved-or-created by name, not by id.',
        foreignKey: {
          tool: 'list_rows',
          valueField: 'name',
          labelField: 'name',
          allowCreate: true,
          args: { table: 'party', where: { isSupplier: true } },
        },
      },
      {
        name: 'lines',
        label: 'Order lines',
        widget: 'line_items',
        required: true,
        itemFields: [
          {
            name: 'materialId',
            label: 'Material',
            widget: 'foreign_key',
            required: true,
            foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
          },
          { name: 'quantity', label: 'Quantity', widget: 'number', required: true },
          { name: 'rate', label: 'Rate', widget: 'number', required: true },
          { name: 'hsnCode', label: 'HSN code', widget: 'text', required: false },
          { name: 'gstRate', label: 'GST rate (%)', widget: 'number', required: false },
        ],
      },
      { name: 'expectedDate', label: 'Expected date', widget: 'date', required: false },
      {
        name: 'triggeredByJobId',
        label: 'Triggered by job',
        widget: 'foreign_key',
        required: false,
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'number', args: { table: 'job' } },
      },
    ],
    submitLabel: 'Create purchase order',
  },
  handler: async (ctx, args) => {
    if (args.lines.length < 1) {
      return { ok: false, error: 'A purchase order must have at least one line', code: 'EMPTY_PO' };
    }
    for (const line of args.lines) {
      if (line.rate === undefined) {
        return {
          ok: false,
          error: `Line for material ${line.materialId} is missing rate — never defaulted automatically`,
          code: 'MISSING_RATE',
        };
      }
    }

    try {
      const supplier = args.supplierId
        ? await ctx.prisma.party.findUnique({ where: { id: args.supplierId } })
        : await ctx.prisma.$transaction((tx) => resolveOrCreateByName(tx, 'supplier', args.supplierName!));

      if (!supplier) {
        return { ok: false, error: 'No party found for the given supplierId', code: 'SUPPLIER_NOT_FOUND' };
      }

      const subTotal = args.lines.reduce((sum, l) => sum + l.quantity * l.rate!, 0);
      const gstAmount = args.lines.reduce((sum, l) => sum + l.quantity * l.rate! * ((l.gstRate ?? 0) / 100), 0);
      const totalValue = subTotal + gstAmount;

      const po = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const thresholdSetting = await tx.setting.findUnique({ where: { key: 'po.approval_threshold_inr' } });
          // No threshold configured → conservatively require approval on
          // everything rather than silently auto-approving every PO.
          const threshold = thresholdSetting ? Number(thresholdSetting.value) : 0;
          const status = totalValue > threshold ? 'PENDING_APPROVAL' : 'APPROVED';

          const poDate = new Date();
          const number = await nextNumber(tx, 'PO', indianFinancialYear(poDate));

          const created = await tx.purchaseOrder.create({
            data: {
              number,
              supplierId: supplier.id,
              poDate,
              status,
              triggeredByJobId: args.triggeredByJobId,
              subTotal,
              gstAmount,
              totalValue,
              expectedDate: args.expectedDate,
              createdById: ctx.userId,
              lines: {
                create: args.lines.map((l) => ({
                  materialId: l.materialId,
                  quantity: l.quantity,
                  rate: l.rate!,
                  hsnCode: l.hsnCode,
                  gstRate: l.gstRate,
                  amount: l.quantity * l.rate!,
                })),
              },
            },
            include: { lines: true },
          });

          if (status === 'PENDING_APPROVAL') {
            const owners = await tx.user.findMany({ where: { role: 'OWNER', isActive: true } });
            for (const owner of owners) {
              await tx.notification.create({
                data: {
                  userId: owner.id,
                  type: 'PO_PENDING_APPROVAL',
                  title: `PO ${created.number} needs approval`,
                  body: `Purchase order ${created.number} (₹${totalValue.toFixed(2)}) is above the approval threshold and needs your approval.`,
                  entityType: 'PurchaseOrder',
                  entityId: created.id,
                },
              });
            }
          }

          return created;
        },
        (po) => ({
          entityType: 'PurchaseOrder',
          entityId: po.id,
          action: 'CREATE',
          toolName: 'create_purchase_order',
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
