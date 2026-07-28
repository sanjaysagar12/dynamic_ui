-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — 01 · TABLES
--  Extensions, enum types, and every table. Run this FIRST.
--  Depends on nothing. Run 02_guards.sql next.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  VIJAYA ELECTRONICS ERP — FULL SCHEMA + INVARIANTS
--  Paste this whole file into the Supabase SQL Editor and run once.
--  Order matters: extensions → enums → tables (parents before
--  children) → constraints/triggers/views.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gives us gen_random_uuid()

-- ═══════════════════════════════════════════════════════════════════
--  1. ENUM TYPES
-- ═══════════════════════════════════════════════════════════════════

CREATE TYPE "UserRole" AS ENUM ('OWNER','STOREKEEPER');
CREATE TYPE "ActorType" AS ENUM ('HUMAN','AGENT');
CREATE TYPE "NotificationType" AS ENUM (
  'MIN_LEVEL_BREACH','PO_PENDING_APPROVAL',
  'COUNT_PENDING_APPROVAL','UNEXPLAINED_VARIANCE'
);
CREATE TYPE "Uom" AS ENUM ('KG','NOS','MTR','LTR','ROLL','SET');
CREATE TYPE "StockType" AS ENUM ('STANDING','PER_JOB');
CREATE TYPE "MovementType" AS ENUM (
  'OPENING','RECEIPT','ISSUE','RETURN','REJECT_RETURN',
  'SCRAP_IN','SCRAP_SALE','COUNT_ADJUSTMENT','REVERSAL'
);
CREATE TYPE "MovementDirection" AS ENUM ('IN','OUT');
CREATE TYPE "PoStatus" AS ENUM (
  'DRAFT','PENDING_APPROVAL','APPROVED','PARTIALLY_RECEIVED',
  'RECEIVED','CANCELLED','REJECTED'
);
CREATE TYPE "CustomerPoStatus" AS ENUM ('OPEN','CLOSED');
CREATE TYPE "JobType" AS ENUM ('PRODUCTION','SAMPLE');
CREATE TYPE "JobStatus" AS ENUM (
  'OPEN','MATERIAL_ISSUED','IN_PRODUCTION','COMPLETED','CLOSED','CANCELLED'
);
CREATE TYPE "CountStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED');

-- ═══════════════════════════════════════════════════════════════════
--  2. PLATFORM CORE
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT UNIQUE,
  phone      TEXT,
  role       "UserRole" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  "isSupplier" BOOLEAN NOT NULL DEFAULT FALSE,
  "isCustomer" BOOLEAN NOT NULL DEFAULT FALSE,
  gstin       TEXT,
  "addressLine" TEXT,
  city        TEXT,
  state       TEXT,
  pincode     TEXT,
  phone       TEXT,
  email       TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_parties_is_supplier ON parties ("isSupplier");
CREATE INDEX idx_parties_is_customer ON parties ("isCustomer");

CREATE TABLE settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          TEXT UNIQUE NOT NULL,
  value        TEXT NOT NULL,
  "valueType"  TEXT NOT NULL DEFAULT 'string',
  description  TEXT,
  "updatedById" TEXT,
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE number_series (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "docType"     TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  "financialYear" TEXT NOT NULL,
  "lastNumber"  INTEGER NOT NULL DEFAULT 0,
  padding       INTEGER NOT NULL DEFAULT 4,
  UNIQUE ("docType", "financialYear")
);

CREATE TABLE audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  action      TEXT NOT NULL,
  "actorType" "ActorType" NOT NULL,
  "actorId"   UUID REFERENCES users(id),
  "agentRunId" TEXT,
  "toolName"  TEXT,
  reason      TEXT,
  "beforeJson" JSONB,
  "afterJson"  JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON audit_events ("entityType","entityId");
CREATE INDEX idx_audit_agent_run ON audit_events ("agentRunId");
CREATE INDEX idx_audit_created_at ON audit_events ("createdAt");

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"   UUID NOT NULL REFERENCES users(id),
  type       "NotificationType" NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  "entityType" TEXT,
  "entityId"   TEXT,
  "readAt"     TIMESTAMPTZ,
  "emailSentAt" TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_read ON notifications ("userId","readAt");

CREATE TABLE attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "fileName"   TEXT NOT NULL,
  "fileUrl"    TEXT NOT NULL,
  "mimeType"   TEXT,
  "sizeBytes"  INTEGER,
  "uploadedById" TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attachments_entity ON attachments ("entityType","entityId");

-- ═══════════════════════════════════════════════════════════════════
--  3. MATERIAL MASTER
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  uom           "Uom" NOT NULL,
  "stockType"   "StockType" NOT NULL DEFAULT 'PER_JOB',
  "minimumLevel" NUMERIC(18,4),
  "hsnCode"     TEXT,
  "gstRate"     NUMERIC(5,2),
  "isScrap"     BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_materials_name ON materials (name);
CREATE INDEX idx_materials_stocktype_active ON materials ("stockType","isActive");

CREATE TABLE stock_balances (
  "materialId"  UUID PRIMARY KEY REFERENCES materials(id),
  quantity      NUMERIC(18,4) NOT NULL DEFAULT 0,
  "averageRate" NUMERIC(18,4) NOT NULL DEFAULT 0,
  "stockValue"  NUMERIC(18,2) NOT NULL DEFAULT 0,
  "lastMovementAt" TIMESTAMPTZ,
  "lastCountedAt"  TIMESTAMPTZ,
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dormant traceability scaffolding — not exposed anywhere yet.
CREATE TABLE lots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "materialId"   UUID NOT NULL REFERENCES materials(id),
  "lotCode"      TEXT NOT NULL,
  "supplierLotRef" TEXT,
  "mtcReference" TEXT,
  "receivedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("materialId","lotCode")
);

-- ═══════════════════════════════════════════════════════════════════
--  4. JOBS (created before purchase_orders / stock_movements, which
--     both reference jobs)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE customer_pos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number     TEXT NOT NULL,
  "customerId" UUID NOT NULL REFERENCES parties(id),
  "poDate"   TIMESTAMPTZ,
  status     "CustomerPoStatus" NOT NULL DEFAULT 'OPEN',
  notes      TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("customerId","number")
);

CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT UNIQUE NOT NULL,
  "customerId" UUID NOT NULL REFERENCES parties(id),
  "customerPoId" UUID REFERENCES customer_pos(id),
  type         "JobType" NOT NULL DEFAULT 'PRODUCTION',
  "parentJobId" UUID REFERENCES jobs(id),
  "productDescription" TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  "jobDate"    TIMESTAMPTZ NOT NULL,
  "dueDate"    TIMESTAMPTZ,
  status       "JobStatus" NOT NULL DEFAULT 'OPEN',
  "materialCost" NUMERIC(18,2),
  "closedAt"   TIMESTAMPTZ,
  notes        TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jobs_customer_date ON jobs ("customerId","jobDate");
CREATE INDEX idx_jobs_status ON jobs (status);

CREATE TABLE job_bom_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "jobId"      UUID NOT NULL REFERENCES jobs(id),
  "materialId" UUID NOT NULL REFERENCES materials(id),
  "qtyPerPiece" NUMERIC(18,6) NOT NULL,
  "requiredQty" NUMERIC(18,4) NOT NULL,
  "issuedQty"   NUMERIC(18,4) NOT NULL DEFAULT 0,
  "returnedQty" NUMERIC(18,4) NOT NULL DEFAULT 0,
  notes        TEXT,
  UNIQUE ("jobId","materialId")
);

-- ═══════════════════════════════════════════════════════════════════
--  5. PURCHASING
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE purchase_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT UNIQUE NOT NULL,
  "supplierId" UUID NOT NULL REFERENCES parties(id),
  "poDate"     TIMESTAMPTZ NOT NULL,
  status       "PoStatus" NOT NULL DEFAULT 'DRAFT',
  "triggeredByJobId" UUID REFERENCES jobs(id),
  "subTotal"   NUMERIC(18,2) NOT NULL DEFAULT 0,
  "gstAmount"  NUMERIC(18,2) NOT NULL DEFAULT 0,
  "totalValue" NUMERIC(18,2) NOT NULL DEFAULT 0,
  "expectedDate" TIMESTAMPTZ,
  notes        TEXT,
  "createdById"  UUID REFERENCES users(id),
  "approvedById" UUID REFERENCES users(id),
  "approvedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_po_supplier_date ON purchase_orders ("supplierId","poDate");
CREATE INDEX idx_po_status ON purchase_orders (status);

CREATE TABLE purchase_order_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchaseOrderId" UUID NOT NULL REFERENCES purchase_orders(id),
  "materialId"      UUID NOT NULL REFERENCES materials(id),
  quantity          NUMERIC(18,4) NOT NULL,
  rate              NUMERIC(18,4) NOT NULL,
  "hsnCode"         TEXT,
  "gstRate"         NUMERIC(5,2),
  amount            NUMERIC(18,2) NOT NULL,
  "receivedQty"     NUMERIC(18,4) NOT NULL DEFAULT 0
);

CREATE TABLE goods_receipts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT UNIQUE NOT NULL,
  "supplierId" UUID NOT NULL REFERENCES parties(id),
  "purchaseOrderId" UUID REFERENCES purchase_orders(id),
  "receiptDate" TIMESTAMPTZ NOT NULL,
  "supplierInvoiceNo"   TEXT,
  "supplierInvoiceDate" TIMESTAMPTZ,
  "supplierDcNo"        TEXT,
  notes        TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_grn_supplier_date ON goods_receipts ("supplierId","receiptDate");

CREATE TABLE goods_receipt_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "goodsReceiptId" UUID NOT NULL REFERENCES goods_receipts(id),
  "purchaseOrderLineId" UUID REFERENCES purchase_order_lines(id),
  "materialId"     UUID NOT NULL REFERENCES materials(id),
  "receivedQty"    NUMERIC(18,4) NOT NULL,
  "acceptedQty"    NUMERIC(18,4) NOT NULL,
  "rejectedQty"    NUMERIC(18,4) NOT NULL DEFAULT 0,
  "rejectionReason" TEXT,
  rate             NUMERIC(18,4) NOT NULL,
  "hsnCode"        TEXT,
  "gstRate"        NUMERIC(5,2),
  amount           NUMERIC(18,2) NOT NULL
);
CREATE INDEX idx_grn_lines_grn ON goods_receipt_lines ("goodsReceiptId");

-- ═══════════════════════════════════════════════════════════════════
--  6. PHYSICAL COUNT
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE stock_counts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number       TEXT UNIQUE NOT NULL,
  "countDate"  TIMESTAMPTZ NOT NULL,
  status       "CountStatus" NOT NULL DEFAULT 'DRAFT',
  "isOpening"  BOOLEAN NOT NULL DEFAULT FALSE,
  "countedById"  UUID REFERENCES users(id),
  "approvedById" UUID REFERENCES users(id),
  "approvedAt"   TIMESTAMPTZ,
  "rejectionNote" TEXT,
  notes        TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stock_counts_date ON stock_counts ("countDate");
CREATE INDEX idx_stock_counts_status ON stock_counts (status);

CREATE TABLE stock_count_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "stockCountId" UUID NOT NULL REFERENCES stock_counts(id),
  "materialId"   UUID NOT NULL REFERENCES materials(id),
  "systemQty"    NUMERIC(18,4) NOT NULL,
  "countedQty"   NUMERIC(18,4) NOT NULL,
  "differenceQty" NUMERIC(18,4) NOT NULL,
  "reasonCode"   TEXT,
  notes          TEXT,
  UNIQUE ("stockCountId","materialId")
);

-- ═══════════════════════════════════════════════════════════════════
--  7. SCRAP
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE scrap_sales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number      TEXT UNIQUE NOT NULL,
  "buyerId"   UUID REFERENCES parties(id),
  "materialId" UUID NOT NULL REFERENCES materials(id),
  "saleDate"  TIMESTAMPTZ NOT NULL,
  quantity    NUMERIC(18,4) NOT NULL,
  rate        NUMERIC(18,4) NOT NULL,
  amount      NUMERIC(18,2) NOT NULL,
  "invoiceNo" TEXT,
  notes       TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scrap_sales_date ON scrap_sales ("saleDate");

-- ═══════════════════════════════════════════════════════════════════
--  8. THE LEDGER (created last — references almost everything above)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE stock_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "materialId" UUID NOT NULL REFERENCES materials(id),
  type         "MovementType" NOT NULL,
  direction    "MovementDirection" NOT NULL,
  quantity     NUMERIC(18,4) NOT NULL,
  rate         NUMERIC(18,4) NOT NULL,
  value        NUMERIC(18,2) NOT NULL DEFAULT 0,
  "balanceQtyAfter"   NUMERIC(18,4) NOT NULL DEFAULT 0,
  "balanceRateAfter"  NUMERIC(18,4) NOT NULL DEFAULT 0,
  "balanceValueAfter" NUMERIC(18,2) NOT NULL DEFAULT 0,
  "jobId"          UUID REFERENCES jobs(id),
  "grnLineId"      UUID REFERENCES goods_receipt_lines(id),
  "stockCountLineId" UUID REFERENCES stock_count_lines(id),
  "scrapSaleId"    UUID REFERENCES scrap_sales(id),
  "reversalOfId"   UUID UNIQUE REFERENCES stock_movements(id),
  "lotId"          UUID REFERENCES lots(id),
  "reasonCode"     TEXT,
  notes            TEXT,
  "movementDate"   TIMESTAMPTZ NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actorType"      "ActorType" NOT NULL DEFAULT 'HUMAN',
  "actorId"        UUID REFERENCES users(id),
  "agentRunId"     TEXT,
  "toolName"       TEXT
);
CREATE INDEX idx_movements_material_date ON stock_movements ("materialId","movementDate");
CREATE INDEX idx_movements_job ON stock_movements ("jobId");
CREATE INDEX idx_movements_type ON stock_movements (type);
CREATE INDEX idx_movements_created_at ON stock_movements ("createdAt");
CREATE INDEX idx_movements_agent_run ON stock_movements ("agentRunId");
