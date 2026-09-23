// Explicit allowlist for list_rows. A table not listed here cannot be read
// through this tool at all, regardless of what the caller asks for. Adding
// a table here is a deliberate decision — do it per-table, not by pattern
// or by excluding a denylist, since the failure mode of a missing entry
// here is "read blocked" (safe, loud) rather than "read allowed"
// (silent, exactly the bug this fix exists to close).
//
// `select` lists the ONLY columns this tool will ever return for that
// table. `where`/`orderBy` on a call are restricted to this same key set —
// see the handler. This matters even for columns you'd never put in
// `select`: allowing `where: { passwordHash: { startsWith: "x" } }` would
// still leak information about an excluded column one bit at a time via
// whether any rows come back, even if the hash itself is never returned.
//
// This is a table/column *existence* allowlist only — it stops arbitrary
// table/column access, not per-caller-role column hiding (e.g.
// material.code and party.code are both flagged in schema.prisma as
// "never shown to the storekeeper", but list_rows has no notion of role
// when deciding what to `select`, same as it has no per-row ownership
// scoping — both are the same class of still-open question, not attempted
// by this pass. See list-rows-scoping.test.ts.
//
// Per-model decision, every model in schema.prisma accounted for below.

export const LIST_ROWS_ALLOWLIST: Record<string, { select: Record<string, true> }> = {
  // ── ALLOWED — ordinary operational/business data, already readable by
  // any authenticated caller through one purpose-built tool or another; no
  // credentials, no audit/security log, nothing dormant. ──────────────────

  material: {
    select: {
      id: true, code: true, name: true, uom: true, stockType: true,
      minimumLevel: true, hsnCode: true, gstRate: true, isScrap: true,
      isActive: true,
    },
  },
  stockBalance: {
    // materialId is StockBalance's own @id (no separate `id` column), and
    // the money column is `stockValue`, not `value` — verified against
    // schema.prisma rather than assumed.
    select: {
      materialId: true, quantity: true, averageRate: true, stockValue: true,
      lastMovementAt: true, lastCountedAt: true,
    },
  },
  job: {
    select: {
      id: true, number: true, customerId: true, customerPoId: true,
      productDescription: true, quantity: true, status: true, type: true,
      jobDate: true, dueDate: true, materialCost: true, closedAt: true,
    },
  },
  jobBomLine: {
    select: {
      id: true, jobId: true, materialId: true, qtyPerPiece: true,
      requiredQty: true, issuedQty: true, returnedQty: true, notes: true,
    },
  },
  purchaseOrder: {
    select: {
      id: true, number: true, supplierId: true, status: true, subTotal: true,
      gstAmount: true, totalValue: true, expectedDate: true, approvedAt: true,
    },
  },
  purchaseOrderLine: {
    select: {
      id: true, purchaseOrderId: true, materialId: true, quantity: true,
      rate: true, hsnCode: true, gstRate: true, amount: true, receivedQty: true,
    },
  },
  goodsReceipt: {
    select: {
      id: true, number: true, supplierId: true, purchaseOrderId: true,
      receiptDate: true, supplierInvoiceNo: true, supplierInvoiceDate: true,
      supplierDcNo: true, notes: true, createdAt: true,
    },
  },
  goodsReceiptLine: {
    select: {
      id: true, goodsReceiptId: true, purchaseOrderLineId: true, materialId: true,
      receivedQty: true, acceptedQty: true, rejectedQty: true, rejectionReason: true,
      rate: true, hsnCode: true, gstRate: true, amount: true,
    },
  },
  customerPo: {
    select: {
      id: true, number: true, customerId: true, poDate: true, status: true,
      notes: true, createdAt: true,
    },
  },
  party: {
    // code is included deliberately, same call as material.code above — see
    // the header comment on why per-role column hiding isn't this file's job.
    select: {
      id: true, code: true, name: true, isSupplier: true, isCustomer: true,
      gstin: true, addressLine: true, city: true, state: true, pincode: true,
      phone: true, email: true, isActive: true,
    },
  },
  stockCount: {
    select: {
      id: true, number: true, countDate: true, status: true, isOpening: true,
      countedById: true, approvedById: true, approvedAt: true, rejectionNote: true,
      notes: true, createdAt: true,
    },
  },
  stockCountLine: {
    select: {
      id: true, stockCountId: true, materialId: true, systemQty: true,
      countedQty: true, differenceQty: true, reasonCode: true, notes: true,
    },
  },
  scrapSale: {
    select: {
      id: true, number: true, buyerId: true, materialId: true, saleDate: true,
      quantity: true, rate: true, amount: true, invoiceNo: true, notes: true,
      createdAt: true,
    },
  },
  stockMovement: {
    // Same shape get_movement_history already returns to any authenticated
    // caller regardless of role — this doesn't widen exposure beyond that
    // existing purpose-built tool. lotId excluded: it's dormant
    // Lot-traceability plumbing (see Lot's own exclusion below), always
    // null until that feature is switched on, so there's nothing there to
    // read yet and no reason to wire it into a "stable" allowlist select.
    select: {
      id: true, materialId: true, type: true, direction: true, quantity: true,
      rate: true, value: true, balanceQtyAfter: true, balanceRateAfter: true,
      balanceValueAfter: true, jobId: true, grnLineId: true, stockCountLineId: true,
      scrapSaleId: true, reversalOfId: true, reasonCode: true, notes: true,
      movementDate: true, createdAt: true, actorType: true, actorId: true,
      agentRunId: true, toolName: true,
    },
  },

  // ── EXCLUDED — do not add without a deliberate, separate decision. ─────
  //
  // user            — passwordHash (bcrypt hash, but still a credential
  //                    material no read tool should ever surface), plus
  //                    email/phone are real per-person PII (not the same
  //                    class as party's business-contact email/phone).
  // setting         — internal runtime config the owner sets in-app, not
  //                    row data any tool should be listing generically.
  // numberSeries    — internal doc-numbering counters; exposing lastNumber
  //                    leaks business volume (how many POs/jobs/etc. have
  //                    ever been raised) and it's implementation detail,
  //                    not a user-facing entity.
  // auditEvent      — the security/audit trail itself; sensitive by nature,
  //                    and a generic table+where+orderBy reader is exactly
  //                    the wrong way to expose it if it's ever needed.
  // notification    — per-user by design (userId), and there is no
  //                    ownership scoping yet to restrict results to the
  //                    caller's own — same open gap this whole fix
  //                    otherwise leaves unaddressed for row-level scoping,
  //                    so don't add it until that's solved.
  // attachment      — generic entityType/entityId attachment pointer with
  //                    no ownership/entity-type scoping either; a caller
  //                    could list every fileUrl ever uploaded across every
  //                    entity in the system with no restriction at all.
  // lot             — schema.prisma marks this explicit: "DORMANT
  //                    SCAFFOLDING — DO NOT EXPOSE... no tool registers it,
  //                    no UI renders it, the agent never mentions it."
};
