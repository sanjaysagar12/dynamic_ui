import { z } from 'zod';
import type { ToolDefinition } from '../types.js';
import { withAuditedTransaction } from '../../lib/withAuditedTransaction.js';
import { translatePrismaError } from '../../lib/translatePrismaError.js';

const lineSchema = z.object({
  materialId: z.string(),
  quantity: z.number(),
});

const inputSchema = z.object({
  jobId: z.string(),
  lines: z.array(lineSchema).optional(),
});

type Args = z.infer<typeof inputSchema>;

const ISSUABLE_STATUSES = ['OPEN', 'MATERIAL_ISSUED'];

interface EffectiveLine {
  materialId: string;
  quantity: number;
  topUp: boolean;
}

const tool: ToolDefinition<Args> = {
  name: 'issue_material',
  description:
    "Give out material from the store to a job. The everyday case: open it with no lines, which issues everything the job's BOM still needs — first read the job so you can list each material with quantity and unit that will go out. Give lines only for a partial issue or an extra top-up for rework (more than the BOM is allowed and marked as a top-up). Always against a job; ask which job if none is named. Stock may go negative; that is allowed and the owner is notified — mention it in one sentence.",
  inputSchema,
  mutates: true,
  requiredRoles: ['STOREKEEPER', 'OWNER'],
  form: {
    title: 'Issue Material',
    fields: [
      {
        name: 'jobId',
        label: 'Job',
        widget: 'foreign_key',
        required: true,
        foreignKey: { tool: 'get_job', valueField: 'id', labelField: 'number' },
      },
      {
        name: 'lines',
        label: 'Lines (leave empty to issue the full outstanding BOM)',
        widget: 'line_items',
        required: false,
        itemFields: [
          {
            name: 'materialId',
            label: 'Material',
            widget: 'foreign_key',
            required: true,
            foreignKey: { tool: 'search_materials', valueField: 'id', labelField: 'name' },
          },
          { name: 'quantity', label: 'Quantity', widget: 'number', required: true },
        ],
      },
    ],
    submitLabel: 'Issue material',
  },
  handler: async (ctx, args) => {
    // Reinforces the router's own requiredRoles gate rather than relying on
    // it alone — belt-and-suspenders, same convention as Batch C's
    // owner-only tools (approve_purchase_order/reject_purchase_order).
    if (ctx.role !== 'STOREKEEPER' && ctx.role !== 'OWNER') {
      return { ok: false, error: 'Only a STOREKEEPER or OWNER can issue material', code: 'FORBIDDEN_ROLE' };
    }

    const job = await ctx.prisma.job.findUnique({ where: { id: args.jobId } });
    if (!job) {
      return { ok: false, error: 'Job not found', code: 'JOB_NOT_FOUND' };
    }
    if (!ISSUABLE_STATUSES.includes(job.status)) {
      return {
        ok: false,
        error: `Job ${job.number} is ${job.status} — material can only be issued while a job is OPEN or MATERIAL_ISSUED`,
        code: 'JOB_NOT_ISSUABLE',
      };
    }

    const bomLines = await ctx.prisma.jobBomLine.findMany({ where: { jobId: args.jobId } });
    const bomByMaterial = new Map(bomLines.map((l) => [l.materialId, l]));

    let effectiveLines: EffectiveLine[];
    if (args.lines) {
      for (const line of args.lines) {
        if (line.quantity <= 0) {
          return { ok: false, error: 'quantity must be positive for every line', code: 'INVALID_QTY' };
        }
      }
      effectiveLines = args.lines.map((line) => {
        const bomLine = bomByMaterial.get(line.materialId);
        const outstanding = bomLine ? Number(bomLine.requiredQty) - Number(bomLine.issuedQty) : 0;
        return { materialId: line.materialId, quantity: line.quantity, topUp: line.quantity > outstanding };
      });
    } else {
      // Default: exactly the outstanding requirement per BOM line — never a
      // top-up, and lines already fully issued (outstanding <= 0) are
      // dropped rather than posted as a zero/negative-quantity movement
      // (chk_movement_qty_positive would reject that anyway).
      effectiveLines = bomLines
        .map((l) => ({ materialId: l.materialId, quantity: Number(l.requiredQty) - Number(l.issuedQty), topUp: false }))
        .filter((l) => l.quantity > 0);
    }

    // Checked BEFORE this call's own inserts, per the spec — a second issue
    // on an already-MATERIAL_ISSUED job must not re-derive "first issue"
    // from rows this same call is about to create.
    const priorIssueCount = await ctx.prisma.stockMovement.count({ where: { jobId: args.jobId, type: 'ISSUE' } });
    const isFirstIssue = priorIssueCount === 0;

    try {
      const outcome = await withAuditedTransaction(
        ctx,
        async (tx) => {
          const movements = [];
          const affectedMaterialIds = new Set<string>();

          for (const line of effectiveLines) {
            const balance = await tx.stockBalance.findUniqueOrThrow({ where: { materialId: line.materialId } });

            const movement = await tx.stockMovement.create({
              data: {
                materialId: line.materialId,
                type: 'ISSUE',
                direction: 'OUT',
                quantity: line.quantity,
                rate: balance.averageRate,
                // value/balance*After are stamped by the trg_apply_stock_movement
                // DB trigger before insert — these placeholders are overwritten
                // regardless of what's passed here (same convention as
                // record_goods_receipt.ts/withStock).
                value: 0,
                balanceQtyAfter: 0,
                balanceRateAfter: 0,
                balanceValueAfter: 0,
                jobId: args.jobId,
                notes: line.topUp ? 'rework top-up' : undefined,
                movementDate: new Date(),
                actorType: ctx.userId ? 'HUMAN' : 'AGENT',
                actorId: ctx.userId,
                toolName: 'issue_material',
              },
            });
            movements.push(movement);
            affectedMaterialIds.add(line.materialId);

            if (bomByMaterial.has(line.materialId)) {
              await tx.jobBomLine.update({
                where: { jobId_materialId: { jobId: args.jobId, materialId: line.materialId } },
                data: { issuedQty: { increment: line.quantity } },
              });
            }
          }

          let updatedJob = job;
          if (isFirstIssue && movements.length > 0 && job.status === 'OPEN') {
            updatedJob = await tx.job.update({ where: { id: args.jobId }, data: { status: 'MATERIAL_ISSUED' } });
          }

          // Re-read balances AFTER the trigger has applied every movement
          // above — negative stock is allowed (inventory_guards.sql §9), not
          // rolled back, only flagged.
          const negativeMaterials: { materialId: string; quantity: number }[] = [];
          for (const materialId of affectedMaterialIds) {
            const balance = await tx.stockBalance.findUniqueOrThrow({ where: { materialId } });
            if (Number(balance.quantity) < 0) {
              negativeMaterials.push({ materialId, quantity: Number(balance.quantity) });
            }
          }

          let warning: string | undefined;
          if (negativeMaterials.length > 0) {
            // Same "notify every active OWNER" pattern as
            // create_purchase_order.ts's PO_PENDING_APPROVAL — no
            // "notify all owners" helper exists yet, so this is inlined here too.
            const owners = await tx.user.findMany({ where: { role: 'OWNER', isActive: true } });
            // Owners read these — show the material's name and unit, never its id.
            const negMaterials = await tx.material.findMany({
              where: { id: { in: negativeMaterials.map((n) => n.materialId) } },
              select: { id: true, name: true, uom: true },
            });
            const materialLabel = new Map(negMaterials.map((m) => [m.id, m]));
            for (const neg of negativeMaterials) {
              const mat = materialLabel.get(neg.materialId);
              const qtyText = `${neg.quantity.toLocaleString('en-IN')} ${mat ? mat.uom.toLowerCase() : ''}`.trim();
              for (const owner of owners) {
                await tx.notification.create({
                  data: {
                    userId: owner.id,
                    type: 'NEGATIVE_STOCK_WARNING',
                    title: `Negative stock after issuing to job ${job.number}`,
                    body: `${mat ? mat.name : 'A material'} is now at ${qtyText} after issuing to job ${job.number}. Stock may have been received but not yet entered.`,
                    entityType: 'Material',
                    entityId: neg.materialId,
                  },
                });
              }
            }
            warning = `Balance went negative for ${negativeMaterials.length} material(s) after this issue — every OWNER has been notified`;
          }

          return { job: updatedJob, movements, warning };
        },
        (result) => ({
          entityType: 'Job',
          entityId: args.jobId,
          action: 'ISSUE_MATERIAL',
          toolName: 'issue_material',
          afterJson: result.movements,
        }),
      );

      return {
        ok: true,
        data: {
          jobId: outcome.job.id,
          jobStatus: outcome.job.status,
          movements: outcome.movements,
          ...(outcome.warning ? { warning: outcome.warning } : {}),
        },
      };
    } catch (err) {
      const translated = translatePrismaError(err);
      return { ok: false, ...translated };
    }
  },
};

export default tool;
