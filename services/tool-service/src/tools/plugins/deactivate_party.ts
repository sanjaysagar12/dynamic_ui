import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';
import { publicParty } from '../../lib/partyName.js';

const inputSchema = z.object({
  partyId: z.string(),
  reason: z.string().min(1),
});

type Args = z.infer<typeof inputSchema>;

const OPEN_PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'] as const;
const OPEN_JOB_STATUSES = ['OPEN', 'MATERIAL_ISSUED', 'IN_PRODUCTION', 'COMPLETED'] as const;

const tool: ToolDefinition<Args> = {
  name: 'deactivate_party',
  description:
    "Stop using a supplier or customer. They are never deleted — past POs, receipts and jobs keep their name — they just disappear from pickers. Not possible while they still have an open purchase order, an open customer PO or an unfinished job; say which ones are open.",
  inputSchema,
  mutates: true,
  requiredRoles: ['STOREKEEPER', 'OWNER'],
  form: {
    title: 'Stop using supplier / customer',
    fields: [
      {
        name: 'partyId',
        label: 'Supplier / customer',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'search_parties', valueField: 'id', labelField: 'label', args: { role: 'ANY' } },
      },
      { name: 'reason', label: 'Reason', widget: 'text', required: true },
    ],
    submitLabel: 'Stop using',
  },
  handler: async (ctx, args) => {
    try {
      const party = await ctx.prisma.party.findUnique({ where: { id: args.partyId } });
      if (!party) {
        return { ok: false, error: "Couldn't find that supplier or customer.", code: 'PARTY_NOT_FOUND' };
      }
      if (!party.isActive) {
        return { ok: false, error: `${party.name} is already not in use.`, code: 'ALREADY_INACTIVE' };
      }

      const [openPos, openCustomerPos, openJobs] = await Promise.all([
        ctx.prisma.purchaseOrder.findMany({
          where: { supplierId: party.id, status: { in: [...OPEN_PO_STATUSES] } },
          select: { number: true },
        }),
        ctx.prisma.customerPo.findMany({ where: { customerId: party.id, status: 'OPEN' }, select: { number: true } }),
        ctx.prisma.job.findMany({
          where: { customerId: party.id, status: { in: [...OPEN_JOB_STATUSES] } },
          select: { number: true },
        }),
      ]);
      const open = [
        ...openPos.map((p) => `purchase order ${p.number}`),
        ...openCustomerPos.map((p) => `customer PO ${p.number}`),
        ...openJobs.map((j) => `job ${j.number}`),
      ];
      if (open.length > 0) {
        return {
          ok: false,
          error: `${party.name} still has open work: ${open.slice(0, 5).join(', ')}${open.length > 5 ? ` and ${open.length - 5} more` : ''}. Close those first.`,
          code: 'PARTY_HAS_OPEN_WORK',
        };
      }

      const updated = await withAuditedTransaction(
        ctx,
        (tx) => tx.party.update({ where: { id: party.id }, data: { isActive: false } }),
        (p) => ({
          entityType: 'Party',
          entityId: p.id,
          action: 'DEACTIVATE',
          toolName: 'deactivate_party',
          reason: args.reason,
          beforeJson: party,
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
