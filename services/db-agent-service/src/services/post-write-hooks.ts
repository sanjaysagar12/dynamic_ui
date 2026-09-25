import type { ToolCatalogEntry } from './tool-service-client.js';
import type { FormSpec } from '../schemas.js';
import type { ToolResult } from './tool-service-client.js';

/**
 * A small, explicit allowlist from mutating tool name -> what to do once that write succeeds —
 * not a generic "run any tool after any tool" system. Same philosophy as
 * list-rows-allowlist.ts's table/column allowlist: enumerate exactly what's permitted, reject
 * everything else. Two kinds of follow-up, both non-negotiably read-only or proposal-only:
 *  - followUpTools: read-only tool calls whose results get narrated into one short reply.
 *  - offers: a suggested next form, pre-filled from the write's own result — never executed here,
 *    only offered; the user must open and submit it themselves like any other form.
 * Business source for the current entries: business-flow-inventory.md §6, §8, §9, §12.
 */

export interface PostWriteFollowUpContext {
  /** Every result this hook's followUpTools produced, keyed by tool name (a step whose buildArgs
   *  returned multiple arg-sets appears here as multiple entries for that same tool name). */
  followUps: Record<string, ToolResult[]>;
}

export interface PostWriteFollowUpStep {
  tool: string;
  /** A step whose buildArgs returns undefined (or whose call fails) is normally treated as a hard
   *  failure — the whole hook degrades to the plain success line rather than narrating from
   *  partial data. Mark `optional: true` for a step that's only sometimes applicable (e.g. "only
   *  if this receipt is linked to a job") — then a skipped/failed call is simply omitted from the
   *  narration instead of aborting it. Returning an ARRAY of arg-sets calls the tool once per
   *  entry (for a tool whose input only takes one id at a time, e.g. get_purchase_price_history
   *  needs one call per material on a multi-line receipt). */
  optional?: boolean;
  buildArgs: (
    writeArgs: Record<string, unknown>,
    writeResult: unknown,
  ) => Record<string, unknown> | Record<string, unknown>[] | undefined;
}

export interface PostWriteOffer {
  label: string;
  /** Must resolve to a `mutates: true` tool with a form — see validatePostWriteHooks. */
  tool: string;
  /** Computes the offered form's prefill from the write's own args/result and every follow-up
   *  step's results. Return undefined to suppress this offer for this particular outcome (e.g. no
   *  shortfall -> no "raise a PO" offer). Never pre-fill a rate — the user must always give one. */
  buildPrefill: (
    ctx: { writeArgs: Record<string, unknown>; writeResult: unknown } & PostWriteFollowUpContext,
  ) => Record<string, unknown> | undefined;
}

export interface PostWriteHook {
  followUpTools: PostWriteFollowUpStep[];
  /** Guidance for the one-more-turn model call that narrates the write (and any follow-up
   *  results) into a short reply — describes what kind of proactive note to write, not literal
   *  text to show. Always runs when a hook fires, even with zero followUpTools, so a write whose
   *  own result already carries the interesting information (a PO's approval status, a job's
   *  material cost) still gets phrased properly instead of the generic "✓ Title — number." line. */
  followUpInstruction: string;
  offers?: PostWriteOffer[];
}

export const POST_WRITE_HOOKS: Record<string, PostWriteHook> = {
  create_party: {
    followUpTools: [],
    followUpInstruction:
      "A supplier/customer was just saved. The write result's `outcome` is CREATED (a new entry) or " +
      "TYPE_ADDED (an existing business was also marked as supplier or customer — say that plainly, " +
      "it is not a second entry). Confirm using the name and city; never show an id or internal code. " +
      'If no GSTIN was captured, mention in one short clause that it can be added later.',
    offers: [
      {
        label: 'Raise a purchase order to them',
        tool: 'create_purchase_order',
        buildPrefill: ({ writeResult }) => {
          const p = writeResult as { name?: string; isSupplier?: boolean };
          // Name only — the PO form picks the supplier by name. Never pre-fill lines or rates.
          return p.name && p.isSupplier ? { supplierName: p.name } : undefined;
        },
      },
      {
        label: 'Record a customer PO from them',
        tool: 'create_customer_po',
        buildPrefill: ({ writeResult }) => {
          const p = writeResult as { name?: string; isCustomer?: boolean };
          return p.name && p.isCustomer ? { customerName: p.name } : undefined;
        },
      },
    ],
  },

  create_customer_po: {
    followUpTools: [],
    followUpInstruction:
      'The customer PO was just recorded successfully. Confirm it plainly using its number from the ' +
      "write result. This only records the PO — it isn't a job yet; creating one is a separate, " +
      'user-initiated next step.',
    offers: [
      {
        label: 'Create a job for this PO',
        tool: 'create_job',
        buildPrefill: ({ writeResult }) => {
          const po = writeResult as { id?: string; customerId?: string };
          if (!po.id || !po.customerId) return undefined;
          return { customerPoId: po.id, customerId: po.customerId };
        },
      },
    ],
  },

  create_job: {
    followUpTools: [],
    followUpInstruction: 'The job was just created successfully. Confirm it plainly using its number from the write result.',
    offers: [
      {
        label: 'Add the BOM',
        tool: 'set_job_bom',
        buildPrefill: ({ writeResult }) => {
          const job = writeResult as { id?: string };
          return job.id ? { jobId: job.id } : undefined;
        },
      },
    ],
  },

  set_job_bom: {
    followUpTools: [
      {
        tool: 'check_job_shortage',
        buildArgs: (writeArgs) => ({ jobId: (writeArgs as { jobId: string }).jobId }),
      },
    ],
    followUpInstruction:
      'The job BOM was just saved successfully. Given the shortage check result below, write a ' +
      'short, natural confirmation. If there is a shortfall on any material, mention it plainly ' +
      'and offer to raise a purchase order for it — but do not raise one yourself; this is an ' +
      "offer the user must accept in their next message, not an action to take now. If there's " +
      'no shortfall, just confirm the save plainly — do not invent a shortage that is not in the data.',
    offers: [
      {
        label: 'Raise a PO for the shortfall',
        tool: 'create_purchase_order',
        buildPrefill: ({ writeArgs, followUps }) => {
          const shortage = followUps['check_job_shortage']?.[0];
          if (!shortage?.ok) return undefined;
          const rows = shortage.data as Array<{ materialId: string; shortfall: number }>;
          const shortLines = rows.filter((r) => r.shortfall > 0);
          if (shortLines.length === 0) return undefined;
          return {
            triggeredByJobId: (writeArgs as { jobId: string }).jobId,
            // rate deliberately left out of every line — never pre-filled, the user must give one.
            lines: shortLines.map((r) => ({ materialId: r.materialId, quantity: r.shortfall })),
          };
        },
      },
      {
        label: 'Issue material now',
        tool: 'issue_material',
        buildPrefill: ({ writeArgs, followUps }) => {
          const shortage = followUps['check_job_shortage']?.[0];
          if (!shortage?.ok) return undefined;
          const rows = shortage.data as Array<{ shortfall: number }>;
          if (rows.some((r) => r.shortfall > 0)) return undefined;
          return { jobId: (writeArgs as { jobId: string }).jobId };
        },
      },
    ],
  },

  create_purchase_order: {
    followUpTools: [],
    followUpInstruction:
      "The purchase order was just created successfully. Using the write result's status, tell the " +
      "user plainly whether it's still waiting for the owner's approval (status PENDING_APPROVAL) or " +
      'already approved and ready to send to the supplier (status APPROVED), and its number.',
  },

  // approve_purchase_order / reject_purchase_order: the business spec's only real follow-up value
  // here is telling the STOREKEEPER (via notify), not narrating anything new back to the OWNER who
  // just took the action — describeSuccess's default line already covers that. Deferred until
  // notify is in scope (see the "notify" decision this feature's rollout deliberately deferred).

  record_goods_receipt: {
    followUpTools: [
      {
        tool: 'get_purchase_price_history',
        // One call per distinct material on the receipt — get_purchase_price_history takes a
        // single materialId, unlike get_material_balance's materialIds array.
        buildArgs: (writeArgs) => {
          const args = writeArgs as { lines: Array<{ materialId: string }> };
          return [...new Set(args.lines.map((l) => l.materialId))].map((materialId) => ({ materialId }));
        },
      },
    ],
    followUpInstruction:
      'The goods receipt was just recorded successfully (see its number and lines in the write ' +
      "result). Each get_purchase_price_history result below is one receipt material's past rates, " +
      "newest first — its own first entry is usually this same receipt, so compare against that " +
      "result's SECOND entry (the most recent prior rate) where one exists. If any material's rate " +
      'moved by more than 5% versus that prior rate, say so plainly with the old and new rate. If ' +
      'any line on this receipt was rejected (rejectedQty > 0), mention the rejected quantity and ' +
      'material — it goes back to the supplier. Otherwise just confirm the receipt plainly.',
    // Deferred: the spec also wants "job now has no shortfall -> offer to issue material", but
    // that needs the linked PO's triggeredByJobId and no get_purchase_order-by-id tool exists yet
    // to resolve it from this receipt's purchaseOrderId — adding a guessed dependency here would
    // be worse than leaving it out.
  },

  issue_material: {
    followUpTools: [
      {
        tool: 'get_material_balance',
        buildArgs: (writeArgs, writeResult) => {
          const result = writeResult as { movements?: Array<{ materialId: string }> };
          const materialIds = [...new Set((result.movements ?? []).map((m) => m.materialId))];
          return materialIds.length > 0 ? { materialIds } : undefined;
        },
      },
    ],
    followUpInstruction:
      'Material was just issued successfully. If the write result has a "warning" field, stock went ' +
      'negative for one or more materials — say so plainly; every OWNER has already been notified ' +
      'automatically, no further action is needed for that. Separately, using the balances below: ' +
      'for any material whose material.stockType is STANDING and whose quantity is now below its ' +
      'material.minimumLevel, say it is now below minimum with the current and minimum figures. If ' +
      'nothing is negative or below minimum, just confirm the issue plainly.',
    offers: [
      {
        label: 'Raise a PO for materials below minimum',
        tool: 'create_purchase_order',
        buildPrefill: ({ followUps }) => {
          const balances = followUps['get_material_balance']?.[0];
          if (!balances?.ok) return undefined;
          const rows = balances.data as Array<{
            materialId: string;
            quantity: number;
            material: { stockType: string; minimumLevel: number | string | null };
          }>;
          const below = rows.filter(
            (r) =>
              r.material.stockType === 'STANDING' &&
              r.material.minimumLevel != null &&
              Number(r.quantity) < Number(r.material.minimumLevel),
          );
          if (below.length === 0) return undefined;
          return {
            lines: below.map((r) => ({ materialId: r.materialId, quantity: Number(r.material.minimumLevel) - Number(r.quantity) })),
          };
        },
      },
    ],
  },

  return_material: {
    followUpTools: [{ tool: 'get_job', buildArgs: (writeArgs) => ({ jobId: (writeArgs as { jobId: string }).jobId }) }],
    followUpInstruction:
      'Material was just returned to stock successfully. Confirm it plainly, naming the job by its ' +
      'number from the job details below.',
    offers: [
      {
        label: 'Close this job',
        tool: 'close_job',
        buildPrefill: ({ writeArgs }) => ({ jobId: (writeArgs as { jobId: string }).jobId }),
      },
    ],
  },

  close_job: {
    followUpTools: [{ tool: 'get_job_bom_variance', buildArgs: (writeArgs) => ({ jobId: (writeArgs as { jobId: string }).jobId }) }],
    followUpInstruction:
      'The job was just closed successfully. State its material cost plainly in rupees (₹) from the ' +
      "write result (result.job.materialCost, per piece too if you can work it out from the job's " +
      'quantity). Using the variance rows below: for any material whose variance_pct is more than ' +
      '+5%, list it with its planned vs actually-used amount and the percentage over. If nothing is ' +
      'over by more than 5%, just confirm the closure and its cost.',
  },

  record_scrap_sale: {
    followUpTools: [
      { tool: 'get_material_balance', buildArgs: (writeArgs) => ({ materialIds: [(writeArgs as { materialId: string }).materialId] }) },
    ],
    followUpInstruction:
      'Scrap was just sold successfully. If the write result has a "warning" field, more scrap was ' +
      'sold than recorded as collected — say so plainly. Using the balance below, state how much of ' +
      'this scrap material is left in stock. Keep it short.',
  },

  start_stock_count: {
    followUpTools: [],
    followUpInstruction:
      'A stock count was just started successfully. Confirm it plainly using its number. If the write ' +
      "result's isOpening is true, briefly explain this is the opening count: enter the quantity and the " +
      'rate from the last purchase invoice for each material (the invoice number is optional), and it can ' +
      'be done over several days. Never suggest a rate.',
  },

  submit_stock_count: {
    followUpTools: [],
    followUpInstruction:
      'The stock count was just submitted to the owner successfully. If the write result has ' +
      'isOpening: true, state the number of materials and the total opening value in rupees ' +
      '(openingValue) — do NOT talk about differences, nothing differs on day one. Otherwise state how ' +
      'many materials differ (materialsWithDifference) and the total variance value in rupees ' +
      "(totalVarianceValue). Either way, make clear stock won't change until the owner approves.",
  },

  approve_stock_count: {
    followUpTools: [],
    followUpInstruction:
      'The stock count was just approved successfully. Confirm plainly that stock now matches what was ' +
      'counted, using its number from the write result. If it was the opening count, say the opening ' +
      'stock is now in at the invoice rates and the system is live.',
    // Deferred: the spec also offers "see the leak report", but get_leak_report doesn't exist yet
    // (see business-flow-inventory.md's own missingTools note) — hidden until it does.
  },

  // reject_stock_count: same reasoning as approve/reject_purchase_order — the spec's value here is
  // telling the STOREKEEPER (notify), not the OWNER who just rejected it. Deferred with those.

  reverse_movement: {
    followUpTools: [
      {
        tool: 'get_material_balance',
        buildArgs: (_writeArgs, writeResult) => {
          const reversal = writeResult as { materialId?: string };
          return reversal.materialId ? { materialIds: [reversal.materialId] } : undefined;
        },
      },
    ],
    followUpInstruction:
      'The stock movement reversal was just recorded successfully. Using the balance below, state the ' +
      "material's current quantity plainly. Mention that both the original entry and this correction " +
      'stay visible in the movement history.',
  },
};

/** Fails loudly at startup (mirrors tool-service's ToolRegistry constructor) if a hook is
 *  misconfigured:
 *   - references a trigger tool that doesn't exist, or one that isn't mutating;
 *   - a followUpTools entry references a tool that doesn't exist, or one that mutates — chaining
 *     into another write would recreate the unconfirmed-write problem this mechanism exists to
 *     avoid, so it must never be possible to configure, not just discouraged;
 *   - an offers entry references a tool that doesn't exist, isn't mutating, or has no form — an
 *     offer opens a form for the user to submit, so it only ever makes sense for a tool that has one. */
export function validatePostWriteHooks(catalog: ToolCatalogEntry[]): void {
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));

  for (const [triggerName, hook] of Object.entries(POST_WRITE_HOOKS)) {
    const trigger = byName.get(triggerName);
    if (!trigger) {
      throw new Error(`post-write hook registered for unknown tool "${triggerName}"`);
    }
    if (!trigger.mutates) {
      throw new Error(`post-write hook registered for "${triggerName}", which is not a mutating tool`);
    }

    for (const step of hook.followUpTools) {
      const followUp = byName.get(step.tool);
      if (!followUp) {
        throw new Error(`post-write hook for "${triggerName}" references unknown follow-up tool "${step.tool}"`);
      }
      if (followUp.mutates) {
        throw new Error(
          `post-write hook for "${triggerName}" references "${step.tool}", which mutates — follow-up tools must be ` +
            'read-only (mutates: false)',
        );
      }
    }

    for (const offer of hook.offers ?? []) {
      const offerTool = byName.get(offer.tool);
      if (!offerTool) {
        throw new Error(`post-write hook for "${triggerName}" offers unknown tool "${offer.tool}"`);
      }
      if (!offerTool.mutates || !offerTool.form) {
        throw new Error(
          `post-write hook for "${triggerName}" offers "${offer.tool}", which must be a mutating tool with a form`,
        );
      }
    }
  }
}

export interface ResolvedPostWriteOffer {
  label: string;
  toolName: string;
  form: FormSpec;
  prefill: Record<string, unknown>;
}
