import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const REASONS = ['SPILLAGE', 'EXTRA_WASTAGE', 'MISSING', 'ENTRY_ERROR', 'UNEXPLAINED'] as const;

const inputSchema = z.object({
  stockCountLineId: z.string(),
  // Optional so a rate can be added later on its own ("tape ₹3.10") without re-entering the quantity.
  countedQty: z.number().nonnegative().optional(),
  reasonCode: z.enum(REASONS).optional(),
  notes: z.string().optional(),
  // Opening count only.
  unitRate: z.number().positive().optional(),
  sourceInvoiceNo: z.string().optional(),
  sourceInvoiceDate: z.coerce.date().optional(),
});

type Args = z.infer<typeof inputSchema>;

const tool: ToolDefinition<Args> = {
  name: 'submit_count_line',
  description:
    "Record what was physically counted for one material on the count being worked on. Can be changed again until the count is sent to the owner, and again if the owner sends it back. NORMAL counts: if the quantity differs from the system, ask for a reason ONCE — spillage, extra wastage, missing, entry error, or unexplained. 'I don't know' is UNEXPLAINED: accept it and move on, never ask again and never suggest a reason. OPENING count: no reasons at all (nothing differs on day one); instead record the rate per unit from the LAST PURCHASE INVOICE for that material — the invoice number is optional. Never suggest, estimate or default a rate; if the storekeeper doesn't have it, leave it and move on. A rate alone can be added later without re-entering the quantity.",
  inputSchema,
  mutates: true,
  form: {
    title: 'Record count',
    fields: [
      {
        name: 'stockCountLineId',
        label: 'Material',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'list_count_lines', valueField: 'id', labelField: 'label' },
      },
      { name: 'countedQty', label: 'Counted quantity', widget: 'number', required: false },
      {
        name: 'reasonCode',
        label: 'Reason for difference (normal counts only)',
        widget: 'select',
        required: false,
        options: [
          { value: 'UNEXPLAINED', label: "Don't know" },
          { value: 'SPILLAGE', label: 'Spillage' },
          { value: 'EXTRA_WASTAGE', label: 'Extra wastage' },
          { value: 'MISSING', label: 'Missing' },
          { value: 'ENTRY_ERROR', label: 'Entry error' },
        ],
      },
      { name: 'unitRate', label: 'Rate per unit ₹ (opening count only)', widget: 'number', required: false, helpText: 'From the last purchase invoice for this material.' },
      { name: 'sourceInvoiceNo', label: 'Invoice no. (optional)', widget: 'text', required: false },
      { name: 'sourceInvoiceDate', label: 'Invoice date (optional)', widget: 'date', required: false },
      { name: 'notes', label: 'Notes', widget: 'textarea', required: false },
    ],
    submitLabel: 'Save',
  },
  handler: async (ctx, args) => {
    const line = await ctx.prisma.stockCountLine.findUnique({
      where: { id: args.stockCountLineId },
      include: { stockCount: true, material: true },
    });
    if (!line) {
      return { ok: false, error: 'Stock count line not found', code: 'LINE_NOT_FOUND' };
    }
    const count = line.stockCount;
    // REJECTED = sent back by the owner: the storekeeper fixes the same count and resubmits.
    if (count.status !== 'DRAFT' && count.status !== 'REJECTED') {
      return {
        ok: false,
        error:
          count.status === 'PENDING_APPROVAL'
            ? `Count ${count.number} is with the owner. It can only be changed if he sends it back.`
            : `Count ${count.number} is already ${count.status.toLowerCase()} and can't be changed.`,
        code: 'NOT_DRAFT',
      };
    }

    const givesRate = args.unitRate !== undefined || args.sourceInvoiceNo !== undefined || args.sourceInvoiceDate !== undefined;
    if (!count.isOpening && givesRate) {
      return {
        ok: false,
        error: 'Rates are only entered on the opening count. Normal counts use the current average rate.',
        code: 'RATE_NOT_ALLOWED',
      };
    }

    const countedQty = args.countedQty ?? (line.countedQty === null ? undefined : Number(line.countedQty));
    if (countedQty === undefined) {
      return { ok: false, error: `Enter the counted quantity for ${line.material.name}.`, code: 'COUNTED_QTY_REQUIRED' };
    }

    const differenceQty = countedQty - Number(line.systemQty);
    // Opening count: never a reason. Normal count: a difference with no reason is UNEXPLAINED.
    const reasonCode = count.isOpening
      ? null
      : differenceQty !== 0
        ? args.reasonCode ?? line.reasonCode ?? 'UNEXPLAINED'
        : null;

    try {
      const updated = await withAuditedTransaction(
        ctx,
        (tx) =>
          tx.stockCountLine.update({
            where: { id: args.stockCountLineId },
            data: {
              countedQty,
              differenceQty,
              reasonCode,
              ...(args.notes !== undefined ? { notes: args.notes } : {}),
              ...(count.isOpening && args.unitRate !== undefined ? { unitRate: args.unitRate } : {}),
              ...(count.isOpening && args.sourceInvoiceNo !== undefined ? { sourceInvoiceNo: args.sourceInvoiceNo.trim() || null } : {}),
              ...(count.isOpening && args.sourceInvoiceDate !== undefined ? { sourceInvoiceDate: args.sourceInvoiceDate } : {}),
            },
          }),
        (updated) => ({
          entityType: 'StockCountLine',
          entityId: updated.id,
          action: 'SUBMIT_COUNT_LINE',
          toolName: 'submit_count_line',
          beforeJson: {
            countedQty: line.countedQty,
            differenceQty: line.differenceQty,
            reasonCode: line.reasonCode,
            unitRate: line.unitRate,
            sourceInvoiceNo: line.sourceInvoiceNo,
          },
          afterJson: updated,
        }),
      );

      const stillNeedsRate = count.isOpening && countedQty > 0 && updated.unitRate === null;
      return {
        ok: true,
        data: {
          ...updated,
          material: line.material.name,
          unit: line.material.uom,
          ...(stillNeedsRate ? { note: 'Rate still needed before the opening count can be submitted.' } : {}),
        },
      };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
