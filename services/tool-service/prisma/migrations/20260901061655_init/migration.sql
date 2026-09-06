-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STOREKEEPER');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AGENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MIN_LEVEL_BREACH', 'PO_PENDING_APPROVAL', 'COUNT_PENDING_APPROVAL', 'UNEXPLAINED_VARIANCE');

-- CreateEnum
CREATE TYPE "Uom" AS ENUM ('KG', 'NOS', 'MTR', 'LTR', 'ROLL', 'SET');

-- CreateEnum
CREATE TYPE "StockType" AS ENUM ('STANDING', 'PER_JOB');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'REJECT_RETURN', 'SCRAP_IN', 'SCRAP_SALE', 'COUNT_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "MovementDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CustomerPoStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PRODUCTION', 'SAMPLE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'MATERIAL_ISSUED', 'IN_PRODUCTION', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "isCustomer" BOOLEAN NOT NULL DEFAULT false,
    "gstin" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_series" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "padding" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "agentRunId" TEXT,
    "toolName" TEXT,
    "reason" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uom" "Uom" NOT NULL,
    "stockType" "StockType" NOT NULL DEFAULT 'PER_JOB',
    "minimumLevel" DECIMAL(18,4),
    "hsnCode" TEXT,
    "gstRate" DECIMAL(5,2),
    "isScrap" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "averageRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastMovementAt" TIMESTAMP(3),
    "lastCountedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("materialId")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "supplierLotRef" TEXT,
    "mtcReference" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "direction" "MovementDirection" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "balanceQtyAfter" DECIMAL(18,4) NOT NULL,
    "balanceRateAfter" DECIMAL(18,4) NOT NULL,
    "balanceValueAfter" DECIMAL(18,2) NOT NULL,
    "jobId" TEXT,
    "grnLineId" TEXT,
    "stockCountLineId" TEXT,
    "scrapSaleId" TEXT,
    "reversalOfId" TEXT,
    "lotId" TEXT,
    "reasonCode" TEXT,
    "notes" TEXT,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
    "actorId" TEXT,
    "agentRunId" TEXT,
    "toolName" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "triggeredByJobId" TEXT,
    "subTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expectedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "hsnCode" TEXT,
    "gstRate" DECIMAL(5,2),
    "amount" DECIMAL(18,2) NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "supplierInvoiceNo" TEXT,
    "supplierInvoiceDate" TIMESTAMP(3),
    "supplierDcNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "materialId" TEXT NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL,
    "acceptedQty" DECIMAL(18,4) NOT NULL,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "rate" DECIMAL(18,4) NOT NULL,
    "hsnCode" TEXT,
    "gstRate" DECIMAL(5,2),
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pos" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "poDate" TIMESTAMP(3),
    "status" "CustomerPoStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerPoId" TEXT,
    "type" "JobType" NOT NULL DEFAULT 'PRODUCTION',
    "parentJobId" TEXT,
    "productDescription" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "jobDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "materialCost" DECIMAL(18,2),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_bom_lines" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qtyPerPiece" DECIMAL(18,6) NOT NULL,
    "requiredQty" DECIMAL(18,4) NOT NULL,
    "issuedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returnedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "job_bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "countedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "systemQty" DECIMAL(18,4) NOT NULL,
    "countedQty" DECIMAL(18,4) NOT NULL,
    "differenceQty" DECIMAL(18,4) NOT NULL,
    "reasonCode" TEXT,
    "notes" TEXT,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_sales" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "buyerId" TEXT,
    "materialId" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "invoiceNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrap_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "parties_code_key" ON "parties"("code");

-- CreateIndex
CREATE INDEX "parties_isSupplier_idx" ON "parties"("isSupplier");

-- CreateIndex
CREATE INDEX "parties_isCustomer_idx" ON "parties"("isCustomer");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_docType_financialYear_key" ON "number_series"("docType", "financialYear");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_agentRunId_idx" ON "audit_events"("agentRunId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_idx" ON "attachments"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE INDEX "materials_name_idx" ON "materials"("name");

-- CreateIndex
CREATE INDEX "materials_stockType_isActive_idx" ON "materials"("stockType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "lots_materialId_lotCode_key" ON "lots"("materialId", "lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reversalOfId_key" ON "stock_movements"("reversalOfId");

-- CreateIndex
CREATE INDEX "stock_movements_materialId_movementDate_idx" ON "stock_movements"("materialId", "movementDate");

-- CreateIndex
CREATE INDEX "stock_movements_jobId_idx" ON "stock_movements"("jobId");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_agentRunId_idx" ON "stock_movements"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_poDate_idx" ON "purchase_orders"("supplierId", "poDate");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_number_key" ON "goods_receipts"("number");

-- CreateIndex
CREATE INDEX "goods_receipts_supplierId_receiptDate_idx" ON "goods_receipts"("supplierId", "receiptDate");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_goodsReceiptId_idx" ON "goods_receipt_lines"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_pos_customerId_number_key" ON "customer_pos"("customerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_number_key" ON "jobs"("number");

-- CreateIndex
CREATE INDEX "jobs_customerId_jobDate_idx" ON "jobs"("customerId", "jobDate");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_bom_lines_jobId_materialId_key" ON "job_bom_lines"("jobId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_number_key" ON "stock_counts"("number");

-- CreateIndex
CREATE INDEX "stock_counts_countDate_idx" ON "stock_counts"("countDate");

-- CreateIndex
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stockCountId_materialId_key" ON "stock_count_lines"("stockCountId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "scrap_sales_number_key" ON "scrap_sales"("number");

-- CreateIndex
CREATE INDEX "scrap_sales_saleDate_idx" ON "scrap_sales"("saleDate");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_grnLineId_fkey" FOREIGN KEY ("grnLineId") REFERENCES "goods_receipt_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockCountLineId_fkey" FOREIGN KEY ("stockCountLineId") REFERENCES "stock_count_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_scrapSaleId_fkey" FOREIGN KEY ("scrapSaleId") REFERENCES "scrap_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_triggeredByJobId_fkey" FOREIGN KEY ("triggeredByJobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pos" ADD CONSTRAINT "customer_pos_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customerPoId_fkey" FOREIGN KEY ("customerPoId") REFERENCES "customer_pos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_bom_lines" ADD CONSTRAINT "job_bom_lines_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_bom_lines" ADD CONSTRAINT "job_bom_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_sales" ADD CONSTRAINT "scrap_sales_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrap_sales" ADD CONSTRAINT "scrap_sales_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
