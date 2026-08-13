-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — CREATE QUEST
--  Plain SQL (no Prisma). Run this FIRST, on a clean database.
--  Order: extensions → enums → tables → indexes → FKs → helper triggers.
--  Then run 02_guard_quest.sql, then 03_rls_quest.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Extensions ──────────────────────────────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ── 1. Enums ────────────────────────────────────────────────────────
create type user_role           as enum ('OWNER','STOREKEEPER');
create type actor_type          as enum ('HUMAN','AGENT');
create type uom_type            as enum ('KG','NOS','MTR','LTR','ROLL','SET');
create type stock_type          as enum ('STANDING','PER_JOB');
create type notification_type   as enum ('MIN_LEVEL_BREACH','PO_PENDING_APPROVAL','COUNT_PENDING_APPROVAL','UNEXPLAINED_VARIANCE');
create type customer_po_status  as enum ('OPEN','CLOSED');
create type job_type            as enum ('PRODUCTION','SAMPLE');
create type job_status          as enum ('OPEN','MATERIAL_ISSUED','IN_PRODUCTION','COMPLETED','CLOSED','CANCELLED');
create type count_status        as enum ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED');
create type movement_type       as enum ('OPENING','RECEIPT','ISSUE','RETURN','REJECT_RETURN','SCRAP_IN','SCRAP_SALE','COUNT_ADJUSTMENT','REVERSAL');
create type movement_direction  as enum ('IN','OUT');
create type po_status           as enum ('DRAFT','PENDING_APPROVAL','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED','REJECTED');

-- ── 2. updated_at helper (mirrors Prisma's @updatedAt) ─────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new."updatedAt" := now();
  return new;
end;
$$ language plpgsql;

-- ── 3. PLATFORM CORE ────────────────────────────────────────────────

create table users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text unique,
  phone      text,
  role       user_role not null,
  "isActive" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();

create table parties (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  "isSupplier" boolean not null default false,
  "isCustomer" boolean not null default false,
  gstin        text,
  "addressLine" text,
  city         text,
  state        text,
  pincode      text,
  phone        text,
  email        text,
  "isActive"   boolean not null default true,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);
create index idx_parties_is_supplier on parties ("isSupplier");
create index idx_parties_is_customer on parties ("isCustomer");
create trigger trg_parties_updated_at before update on parties
  for each row execute function set_updated_at();

create table settings (
  id           uuid primary key default gen_random_uuid(),
  key          text unique not null,
  value        text not null,
  "valueType"  text not null default 'string',
  description  text,
  "updatedById" uuid,
  "updatedAt"  timestamptz not null default now()
);

create table number_series (
  id            uuid primary key default gen_random_uuid(),
  "docType"     text not null,
  prefix        text not null,
  "financialYear" text not null,
  "lastNumber"  integer not null default 0,
  padding       integer not null default 4,
  unique ("docType", "financialYear")
);

-- ── 4. MATERIAL MASTER ──────────────────────────────────────────────

create table materials (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  uom           uom_type not null,
  "stockType"   stock_type not null default 'PER_JOB',
  "minimumLevel" numeric(18,4),
  "hsnCode"     text,
  "gstRate"     numeric(5,2),
  "isScrap"     boolean not null default false,
  "isActive"    boolean not null default true,
  notes         text,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);
create index idx_materials_name on materials (name);
create index idx_materials_stocktype_active on materials ("stockType","isActive");
create trigger trg_materials_updated_at before update on materials
  for each row execute function set_updated_at();

create table stock_balances (
  "materialId"     uuid primary key,
  quantity         numeric(18,4) not null default 0,
  "averageRate"    numeric(18,4) not null default 0,
  "stockValue"     numeric(18,2) not null default 0,
  "lastMovementAt" timestamptz,
  "lastCountedAt"  timestamptz,
  "updatedAt"      timestamptz not null default now(),
  constraint fk_balance_material foreign key ("materialId") references materials(id)
);

-- Dormant traceability scaffolding — created, never exposed to the app.
create table lots (
  id             uuid primary key default gen_random_uuid(),
  "materialId"   uuid not null references materials(id),
  "lotCode"      text not null,
  "supplierLotRef" text,
  "mtcReference" text,
  "receivedAt"   timestamptz,
  "createdAt"    timestamptz not null default now(),
  unique ("materialId","lotCode")
);

-- ── 5. JOBS ──────────────────────────────────────────────────────────

create table customer_pos (
  id          uuid primary key default gen_random_uuid(),
  number      text not null,
  "customerId" uuid not null references parties(id),
  "poDate"    timestamptz,
  status      customer_po_status not null default 'OPEN',
  notes       text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("customerId","number")
);
create trigger trg_customer_pos_updated_at before update on customer_pos
  for each row execute function set_updated_at();

create table jobs (
  id           uuid primary key default gen_random_uuid(),
  number       text unique not null,
  "customerId" uuid not null references parties(id),
  "customerPoId" uuid references customer_pos(id),
  type         job_type not null default 'PRODUCTION',
  "parentJobId" uuid references jobs(id),
  "productDescription" text not null,
  quantity     integer not null,
  "jobDate"    timestamptz not null,
  "dueDate"    timestamptz,
  status       job_status not null default 'OPEN',
  "materialCost" numeric(18,2),
  "closedAt"   timestamptz,
  notes        text,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);
create index idx_jobs_customer_date on jobs ("customerId","jobDate");
create index idx_jobs_status on jobs (status);
create trigger trg_jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

create table job_bom_lines (
  id           uuid primary key default gen_random_uuid(),
  "jobId"      uuid not null references jobs(id),
  "materialId" uuid not null references materials(id),
  "qtyPerPiece" numeric(18,6) not null,
  "requiredQty" numeric(18,4) not null,
  "issuedQty"  numeric(18,4) not null default 0,
  "returnedQty" numeric(18,4) not null default 0,
  notes        text,
  unique ("jobId","materialId")
);

-- ── 6. PURCHASING ────────────────────────────────────────────────────

create table purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  number       text unique not null,
  "supplierId" uuid not null references parties(id),
  "poDate"     timestamptz not null,
  status       po_status not null default 'DRAFT',
  "triggeredByJobId" uuid references jobs(id),
  "subTotal"   numeric(18,2) not null default 0,
  "gstAmount"  numeric(18,2) not null default 0,
  "totalValue" numeric(18,2) not null default 0,
  "expectedDate" timestamptz,
  notes        text,
  "createdById" uuid references users(id),
  "approvedById" uuid references users(id),
  "approvedAt" timestamptz,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);
create index idx_po_supplier_date on purchase_orders ("supplierId","poDate");
create index idx_po_status on purchase_orders (status);
create trigger trg_po_updated_at before update on purchase_orders
  for each row execute function set_updated_at();

create table purchase_order_lines (
  id               uuid primary key default gen_random_uuid(),
  "purchaseOrderId" uuid not null references purchase_orders(id),
  "materialId"     uuid not null references materials(id),
  quantity         numeric(18,4) not null,
  rate             numeric(18,4) not null,
  "hsnCode"        text,
  "gstRate"        numeric(5,2),
  amount           numeric(18,2) not null,
  "receivedQty"    numeric(18,4) not null default 0
);
create index idx_pol_po on purchase_order_lines ("purchaseOrderId");

create table goods_receipts (
  id             uuid primary key default gen_random_uuid(),
  number         text unique not null,
  "supplierId"   uuid not null references parties(id),
  "purchaseOrderId" uuid references purchase_orders(id),
  "receiptDate"  timestamptz not null,
  "supplierInvoiceNo" text,
  "supplierInvoiceDate" timestamptz,
  "supplierDcNo" text,
  notes          text,
  "createdAt"    timestamptz not null default now()
);
create index idx_grn_supplier_date on goods_receipts ("supplierId","receiptDate");

create table goods_receipt_lines (
  id                    uuid primary key default gen_random_uuid(),
  "goodsReceiptId"      uuid not null references goods_receipts(id),
  "purchaseOrderLineId" uuid references purchase_order_lines(id),
  "materialId"          uuid not null references materials(id),
  "receivedQty"         numeric(18,4) not null,
  "acceptedQty"         numeric(18,4) not null,
  "rejectedQty"         numeric(18,4) not null default 0,
  "rejectionReason"     text,
  rate                  numeric(18,4) not null,
  "hsnCode"             text,
  "gstRate"             numeric(5,2),
  amount                numeric(18,2) not null
);
create index idx_grl_grn on goods_receipt_lines ("goodsReceiptId");

-- ── 7. PHYSICAL COUNT ───────────────────────────────────────────────

create table stock_counts (
  id           uuid primary key default gen_random_uuid(),
  number       text unique not null,
  "countDate"  timestamptz not null,
  status       count_status not null default 'DRAFT',
  "isOpening"  boolean not null default false,
  "countedById" uuid references users(id),
  "approvedById" uuid references users(id),
  "approvedAt" timestamptz,
  "rejectionNote" text,
  notes        text,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);
create index idx_counts_date on stock_counts ("countDate");
create index idx_counts_status on stock_counts (status);
create trigger trg_counts_updated_at before update on stock_counts
  for each row execute function set_updated_at();

create table stock_count_lines (
  id            uuid primary key default gen_random_uuid(),
  "stockCountId" uuid not null references stock_counts(id),
  "materialId"  uuid not null references materials(id),
  "systemQty"   numeric(18,4) not null,
  "countedQty"  numeric(18,4) not null,
  "differenceQty" numeric(18,4) not null,
  "reasonCode"  text,
  notes         text,
  unique ("stockCountId","materialId")
);

-- ── 8. SCRAP ─────────────────────────────────────────────────────────

create table scrap_sales (
  id          uuid primary key default gen_random_uuid(),
  number      text unique not null,
  "buyerId"   uuid references parties(id),
  "materialId" uuid not null references materials(id),
  "saleDate"  timestamptz not null,
  quantity    numeric(18,4) not null,
  rate        numeric(18,4) not null,
  amount      numeric(18,2) not null,
  "invoiceNo" text,
  notes       text,
  "createdAt" timestamptz not null default now()
);
create index idx_scrap_sale_date on scrap_sales ("saleDate");

-- ── 9. THE LEDGER ────────────────────────────────────────────────────

create table stock_movements (
  id            uuid primary key default gen_random_uuid(),
  "materialId"  uuid not null references materials(id),
  type          movement_type not null,
  direction     movement_direction not null,
  quantity      numeric(18,4) not null,
  rate          numeric(18,4) not null,
  value         numeric(18,2),
  "balanceQtyAfter"   numeric(18,4),
  "balanceRateAfter"  numeric(18,4),
  "balanceValueAfter" numeric(18,2),
  "jobId"           uuid references jobs(id),
  "grnLineId"       uuid references goods_receipt_lines(id),
  "stockCountLineId" uuid references stock_count_lines(id),
  "scrapSaleId"     uuid references scrap_sales(id),
  "reversalOfId"    uuid unique references stock_movements(id),
  "lotId"           uuid references lots(id),
  "reasonCode"      text,
  notes             text,
  "movementDate"    timestamptz not null,
  "createdAt"       timestamptz not null default now(),
  "actorType"       actor_type not null default 'HUMAN',
  "actorId"         uuid references users(id),
  "agentRunId"      text,
  "toolName"        text
);
create index idx_mv_material_date on stock_movements ("materialId","movementDate");
create index idx_mv_job on stock_movements ("jobId");
create index idx_mv_type on stock_movements (type);
create index idx_mv_created on stock_movements ("createdAt");
create index idx_mv_agentrun on stock_movements ("agentRunId");

-- ── 10. AUDIT / NOTIFICATIONS / ATTACHMENTS ─────────────────────────

create table audit_events (
  id           uuid primary key default gen_random_uuid(),
  "entityType" text not null,
  "entityId"   text not null,
  action       text not null,
  "actorType"  actor_type not null,
  "actorId"    uuid references users(id),
  "agentRunId" text,
  "toolName"   text,
  reason       text,
  "beforeJson" jsonb,
  "afterJson"  jsonb,
  "createdAt"  timestamptz not null default now()
);
create index idx_audit_entity on audit_events ("entityType","entityId");
create index idx_audit_agentrun on audit_events ("agentRunId");
create index idx_audit_created on audit_events ("createdAt");

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  "userId"     uuid not null references users(id),
  type         notification_type not null,
  title        text not null,
  body         text not null,
  "entityType" text,
  "entityId"   text,
  "readAt"     timestamptz,
  "emailSentAt" timestamptz,
  "createdAt"  timestamptz not null default now()
);
create index idx_notif_user_read on notifications ("userId","readAt");

create table attachments (
  id            uuid primary key default gen_random_uuid(),
  "entityType"  text not null,
  "entityId"    text not null,
  "fileName"    text not null,
  "fileUrl"     text not null,
  "mimeType"    text,
  "sizeBytes"   integer,
  "uploadedById" uuid,
  "createdAt"   timestamptz not null default now()
);
create index idx_attach_entity on attachments ("entityType","entityId");

-- ═══════════════════════════════════════════════════════════════════
-- Done. Next: run 02_guard_quest.sql (invariants + ledger triggers),
-- then 03_rls_quest.sql (Supabase row-level security).
-- ═══════════════════════════════════════════════════════════════════
