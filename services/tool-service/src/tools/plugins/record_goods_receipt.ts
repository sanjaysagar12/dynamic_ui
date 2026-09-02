import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { nextNumber, indianFinancialYear } from '../../lib/numberSeries.js';

const lineSchema = z.object({
  materialId: z.string(),
  purchaseOrderLineId: z.string().optional(),
  receivedQty: z.number(),
  acceptedQty: z.number(),
  rejectedQty: z.number(),
  rate: z.number(),
  hsnCode: z.string().optional(),
  gstRate: z.number().optional(),
  rejectionReason: z.string().optional(),
});

const inputSchema = z.object({
  supplierId: z.string(),
  purchaseOrderId: z.string().optional(),
  receiptDate: z.coerce.date(),
  supplierInvoiceNo: z.string().optional(),
  supplierInvoiceDate: z.coerce.date().optional(),
  supplierDcNo: z.string().optional(),
  lines: z.array(lineSchema).min(1),
  overrideConfirmed: z.boolean().optional(),
});

type Args = z.infer<typeof inputSchema>;

const PO_READY_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED'];

const tool: ToolDefinition<Args> = {
  name: 'record_goods_receipt',
  description:
    'Record a goods receipt (GRN) against a supplier delivery. Each line splits receivedQty into acceptedQty + rejectedQty — only accepted quantity becomes stock (a RECEIPT movement); rejected quantity is recorded and immediately leaves again (a REJECT_RETURN movement), so both are always visible in the ledger, never netted. ' +
    'overrideConfirmed is a SEPARATE, STRONGER confirmation from the generic write-confirmation gate (confirmed: true): it specifically means "yes, receive against a purchase order that is not yet approved." If purchaseOrderId is given and that PO is still PENDING_APPROVAL, this call fails with PO_NOT_APPROVED unless overrideConfirmed is explicitly true. The orchestrator MUST ask the user about this as its own separate question — never inferred from the ordinary write confirmation.',
  inputSchema,
  mutates: true,
  form: {
    title: 'Record Goods Receipt',
    fields: [
      {
        name: 'supplierId',
        label: 'Supplier',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'name', args: { table: 'party', where: { isSupplier: true } } },
      },
      {
        name: 'purchaseOrderId',
        label: 'Purchase order',
        widget: 'foreign_key',
        required: false,
        helpText: 'Leave blank for a direct receipt not tied to a PO.',
        foreignKey: { tool: 'list_rows', valueField: 'id', labelField: 'number', args: { table: 'purchaseOrder' } },
      },
      { name: 'receiptDate', label: 'Receipt date', widget: 'date', required: true },
      { name: 'supplierInvoiceNo', label: 'Supplier invoice no.', widget: 'text', required: false },
      { name: 'supplierInvoiceDate', label: 'Supplier invoice date', widget: 'date', required: false },
      { name: 'supplierDcNo', label: 'Supplier DC no.', widget: 'text', required: false },
      {
        name: 'lines',
        label: 'Receipt lines',
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
          {
            name: 'purchaseOrderLineId',
            label: 'PO line id',
            widget: 'text',
            required: false,
            helpText: 'Matches this receipt line to a specific ordered line so its receivedQty rolls up. No PO line has a human-readable label — leave blank for a direct receipt.',
          },
          { name: 'receivedQty', label: 'Received qty', widget: 'number', required: true },
          { name: 'acceptedQty', label: 'Accepted qty', widget: 'number', required: true },
          { name: 'rejectedQty', label: 'Rejected qty', widget: 'number', required: true, defaultValue: 0 },
          { name: 'rate', label: 'Rate', widget: 'number', required: true },
          { name: 'hsnCode', label: 'HSN code', widget: 'text', required: false },
          { name: 'gstRate', label: 'GST rate (%)', widget: 'number', required: false },
          {
            name: 'rejectionReason',
            label: 'Rejection reason',
            widget: 'textarea',
            required: false,
            // FormFieldSpec.visibleIf/required are both static (equality-only,
            // boolean), so "required only when this line's rejectedQty > 0"
            // can't be expressed declaratively here — the tool's own handler
            // is the real MISSING_REJECTION_REASON gate. Shown always, with
            // helpText carrying the actual rule, rather than a hidden field
            // that resurfaces an error the user didn't see coming.
            helpText: 'Required when rejectedQty > 0 for this line — enforced when the form is submitted.',
          },
        ],
      },
    ],
    submitLabel: 'Record receipt',
  },
  handler: async (ctx, args) => {
    for (const line of args.lines) {
      if (line.acceptedQty + line.rejectedQty !== line.receivedQty) {
        return {
          ok: false,
          error: `Line for material ${line.materialId}: acceptedQty + rejectedQty must equal receivedQty`,
          code: 'SPLIT_MISMATCH',
        };
      }
      if (line.rejectedQty > 0 && !line.rejectionReason) {
        return {
          ok: false,
          error: `Line for material ${line.materialId}: rejectionReason is required when rejectedQty > 0`,
          code: 'MISSING_REJECTION_REASON',
        };
      }
    }

    let po = null;
    if (args.purchaseOrderId) {
      po = await ctx.prisma.purchaseOrder.findUnique({ where: { id: args.purchaseOrderId } });
      if (!po) {
        return { ok: false, error: 'Purchase order not found', code: 'PO_NOT_FOUND' };
      }
      const overridable = po.status === 'PENDING_APPROVAL' && args.overrideConfirmed === true;
      if (!PO_READY_STATUSES.includes(po.status) && !overridable) {
        return {
          ok: false,
          error: `Purchase order ${po.number} is ${po.status}; receipts require APPROVED or PARTIALLY_RECEIVED (or overrideConfirmed: true against a PENDING_APPROVAL PO)`,
          code: 'PO_NOT_APPROVED',
        };
      }
    }

    try {
      const grn = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const number = await nextNumber(tx, 'GRN', indianFinancialYear(args.receiptDate));

          const created = await tx.goodsReceipt.create({
            data: {
              number,
              supplierId: args.supplierId,
              purchaseOrderId: args.purchaseOrderId,
              receiptDate: args.receiptDate,
              supplierInvoiceNo: args.supplierInvoiceNo,
              supplierInvoiceDate: args.supplierInvoiceDate,
              supplierDcNo: args.supplierDcNo,
              lines: {
                create: args.lines.map((l) => ({
                  purchaseOrderLineId: l.purchaseOrderLineId,
                  materialId: l.materialId,
                  receivedQty: l.receivedQty,
                  acceptedQty: l.acceptedQty,
                  rejectedQty: l.rejectedQty,
                  rejectionReason: l.rejectionReason,
                  rate: l.rate,
                  hsnCode: l.hsnCode,
                  gstRate: l.gstRate,
                  amount: l.receivedQty * l.rate,
                })),
              },
            },
            include: { lines: true },
          });

          // value/balance*After are stamped by the trg_apply_stock_movement
          // DB trigger before insert — the placeholders below are
          // overwritten regardless of what's passed here.
          for (const grnLine of created.lines) {
            if (Number(grnLine.acceptedQty) > 0) {
              await tx.stockMovement.create({
                data: {
                  materialId: grnLine.materialId,
                  type: 'RECEIPT',
                  direction: 'IN',
                  quantity: grnLine.acceptedQty,
                  rate: grnLine.rate,
                  value: 0,
                  balanceQtyAfter: 0,
                  balanceRateAfter: 0,
                  balanceValueAfter: 0,
                  grnLineId: grnLine.id,
                  movementDate: args.receiptDate,
                  actorType: ctx.userId ? 'HUMAN' : 'AGENT',
                  actorId: ctx.userId,
                  toolName: 'record_goods_receipt',
                },
              });
            }
            if (Number(grnLine.rejectedQty) > 0) {
              await tx.stockMovement.create({
                data: {
                  materialId: grnLine.materialId,
                  type: 'REJECT_RETURN',
                  direction: 'OUT',
                  quantity: grnLine.rejectedQty,
                  rate: grnLine.rate,
                  value: 0,
                  balanceQtyAfter: 0,
                  balanceRateAfter: 0,
                  balanceValueAfter: 0,
                  grnLineId: grnLine.id,
                  movementDate: args.receiptDate,
                  notes: grnLine.rejectionReason ?? undefined,
                  actorType: ctx.userId ? 'HUMAN' : 'AGENT',
                  actorId: ctx.userId,
                  toolName: 'record_goods_receipt',
                },
              });
            }
          }

          if (args.purchaseOrderId) {
            for (const grnLine of created.lines) {
              if (grnLine.purchaseOrderLineId) {
                await tx.purchaseOrderLine.update({
                  where: { id: grnLine.purchaseOrderLineId },
                  data: { receivedQty: { increment: grnLine.receivedQty } },
                });
              }
            }

            const poLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: args.purchaseOrderId } });
            const fullyReceived = poLines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
            await tx.purchaseOrder.update({
              where: { id: args.purchaseOrderId },
              data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
            });
          }

          return created;
        },
        (grn) => ({
          entityType: 'GoodsReceipt',
          entityId: grn.id,
          action: 'CREATE',
          toolName: 'record_goods_receipt',
          afterJson: grn,
        }),
      );

      return { ok: true, data: grn };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
