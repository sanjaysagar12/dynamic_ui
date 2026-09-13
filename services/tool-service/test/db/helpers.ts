import { randomUUID } from 'node:crypto';
import type { Client, Pool, PoolClient, QueryResult } from 'pg';

// Layer 1 tests connect with raw `pg` only (no Prisma) — see ARCHITECTURE.md's
// "Planned test layout" row 1. test/factories/*.ts (Phase 0) are Prisma-based
// (they back Layer 2's handler tests), so they aren't reusable here; these are
// this suite's own minimal raw-SQL equivalents, covering only the columns
// Layer 1 actually needs to set.

export type Queryable = Client | PoolClient;

/**
 * Checks a client out of `pool`, runs `fn`, and ALWAYS releases it —
 * including when `fn` (or an assertion inside it) throws. Without this, a
 * failed `expect(...).rejects.toMatchObject(...)` assertion throws past a
 * bare `client.release()` placed after the awaited call, leaking that
 * connection; enough leaked connections exhaust the pool's default max and
 * every subsequent `pool.connect()` (and the file's own `pool.end()` in
 * afterAll) then hangs forever waiting for a connection that's never coming
 * back.
 */
export async function withTestClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export interface MaterialRow {
  id: string;
  code: string;
  name: string;
  uom: string;
  stockType: string;
  minimumLevel: string | null;
  isActive: boolean;
}

export async function insertMaterial(
  client: Queryable,
  overrides: {
    code?: string;
    name?: string;
    uom?: string;
    stockType?: string;
    minimumLevel?: number | null;
    isActive?: boolean;
  } = {},
): Promise<MaterialRow> {
  const suffix = randomUUID().slice(0, 8);
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO materials (id, code, name, uom, "stockType", "minimumLevel", "isActive", "updatedAt")
     VALUES ($1, $2, $3, $4::"Uom", $5::"StockType", $6, $7, NOW())
     RETURNING id, code, name, uom, "stockType", "minimumLevel", "isActive"`,
    [
      id,
      overrides.code ?? `MAT-TEST-${suffix}`,
      overrides.name ?? `Test Material ${suffix}`,
      overrides.uom ?? 'KG',
      overrides.stockType ?? 'PER_JOB',
      overrides.minimumLevel ?? null,
      overrides.isActive ?? true,
    ],
  );
  return result.rows[0];
}

export interface BalanceRow {
  materialId: string;
  quantity: string;
  averageRate: string;
  stockValue: string;
}

export async function getBalance(client: Queryable, materialId: string): Promise<BalanceRow> {
  const result = await client.query(
    `SELECT "materialId", quantity, "averageRate", "stockValue" FROM stock_balances WHERE "materialId" = $1`,
    [materialId],
  );
  if (result.rows.length === 0) {
    throw new Error(`getBalance: no stock_balances row for material ${materialId}`);
  }
  return result.rows[0];
}

export interface MovementOverrides {
  id?: string;
  materialId: string;
  type?: string;
  direction?: string;
  quantity?: number;
  rate?: number;
  jobId?: string | null;
  grnLineId?: string | null;
  stockCountLineId?: string | null;
  scrapSaleId?: string | null;
  reversalOfId?: string | null;
  movementDate?: Date;
}

const DEFAULT_DIRECTION_FOR_TYPE: Record<string, string> = {
  OPENING: 'IN',
  RECEIPT: 'IN',
  RETURN: 'IN',
  SCRAP_IN: 'IN',
  ISSUE: 'OUT',
  REJECT_RETURN: 'OUT',
  SCRAP_SALE: 'OUT',
};

/**
 * Inserts a stock_movements row via plain INSERT. `value`/`balanceQtyAfter`/
 * `balanceRateAfter`/`balanceValueAfter` are required, non-defaulted columns
 * but are overwritten by the BEFORE INSERT trg_apply_stock_movement trigger
 * before the row is stored — the 0 placeholders here are never what lands
 * on disk for a successful insert.
 */
export async function insertMovement(client: Queryable, overrides: MovementOverrides): Promise<QueryResult['rows'][number]> {
  const id = overrides.id ?? randomUUID();
  const type = overrides.type ?? 'RECEIPT';
  const direction = overrides.direction ?? DEFAULT_DIRECTION_FOR_TYPE[type] ?? 'IN';
  const result = await client.query(
    `INSERT INTO stock_movements
       (id, "materialId", type, direction, quantity, rate, value,
        "balanceQtyAfter", "balanceRateAfter", "balanceValueAfter",
        "jobId", "grnLineId", "stockCountLineId", "scrapSaleId", "reversalOfId", "movementDate")
     VALUES
       ($1, $2, $3::"MovementType", $4::"MovementDirection", $5, $6, 0,
        0, 0, 0,
        $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      id,
      overrides.materialId,
      type,
      direction,
      overrides.quantity ?? 10,
      overrides.rate ?? 0,
      overrides.jobId ?? null,
      overrides.grnLineId ?? null,
      overrides.stockCountLineId ?? null,
      overrides.scrapSaleId ?? null,
      overrides.reversalOfId ?? null,
      overrides.movementDate ?? new Date(),
    ],
  );
  return result.rows[0];
}

export async function insertParty(
  client: Queryable,
  overrides: { isSupplier?: boolean; isCustomer?: boolean; code?: string; name?: string } = {},
): Promise<{ id: string }> {
  const suffix = randomUUID().slice(0, 8);
  const result = await client.query(
    `INSERT INTO parties (id, code, name, "isSupplier", "isCustomer", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id`,
    [
      randomUUID(),
      overrides.code ?? `PTY-TEST-${suffix}`,
      overrides.name ?? `Test Party ${suffix}`,
      overrides.isSupplier ?? false,
      overrides.isCustomer ?? true,
    ],
  );
  return result.rows[0];
}

export async function insertJob(
  client: Queryable,
  overrides: { customerId?: string; number?: string; quantity?: number } = {},
): Promise<{ id: string }> {
  const suffix = randomUUID().slice(0, 8);
  const customerId = overrides.customerId ?? (await insertParty(client, { isCustomer: true })).id;
  const result = await client.query(
    `INSERT INTO jobs (id, number, "customerId", "productDescription", quantity, "jobDate", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING id`,
    [randomUUID(), overrides.number ?? `JOB-TEST-${suffix}`, customerId, `Test product ${suffix}`, overrides.quantity ?? 100],
  );
  return result.rows[0];
}

export async function insertJobBomLine(
  client: Queryable,
  overrides: { jobId?: string; materialId?: string; qtyPerPiece?: number; requiredQty?: number } = {},
): Promise<{ id: string }> {
  const jobId = overrides.jobId ?? (await insertJob(client)).id;
  const materialId = overrides.materialId ?? (await insertMaterial(client)).id;
  const qtyPerPiece = overrides.qtyPerPiece ?? 1;
  const requiredQty = overrides.requiredQty ?? qtyPerPiece;
  const result = await client.query(
    `INSERT INTO job_bom_lines (id, "jobId", "materialId", "qtyPerPiece", "requiredQty")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [randomUUID(), jobId, materialId, qtyPerPiece, requiredQty],
  );
  return result.rows[0];
}

export async function insertGoodsReceipt(
  client: Queryable,
  overrides: { supplierId?: string; number?: string } = {},
): Promise<{ id: string }> {
  const suffix = randomUUID().slice(0, 8);
  const supplierId = overrides.supplierId ?? (await insertParty(client, { isSupplier: true, isCustomer: false })).id;
  const result = await client.query(
    `INSERT INTO goods_receipts (id, number, "supplierId", "receiptDate")
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [randomUUID(), overrides.number ?? `GRN-TEST-${suffix}`, supplierId],
  );
  return result.rows[0];
}

export async function insertGoodsReceiptLine(
  client: Queryable,
  overrides: {
    goodsReceiptId?: string;
    materialId?: string;
    receivedQty?: number;
    acceptedQty?: number;
    rejectedQty?: number;
    rate?: number;
  } = {},
): Promise<{ id: string }> {
  const goodsReceiptId = overrides.goodsReceiptId ?? (await insertGoodsReceipt(client)).id;
  const materialId = overrides.materialId ?? (await insertMaterial(client)).id;
  const receivedQty = overrides.receivedQty ?? 100;
  const acceptedQty = overrides.acceptedQty ?? receivedQty;
  const rejectedQty = overrides.rejectedQty ?? receivedQty - acceptedQty;
  const rate = overrides.rate ?? 10;
  const result = await client.query(
    `INSERT INTO goods_receipt_lines
       (id, "goodsReceiptId", "materialId", "receivedQty", "acceptedQty", "rejectedQty", rate, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [randomUUID(), goodsReceiptId, materialId, receivedQty, acceptedQty, rejectedQty, rate, acceptedQty * rate],
  );
  return result.rows[0];
}

export async function insertStockCount(
  client: Queryable,
  overrides: { status?: string; number?: string } = {},
): Promise<{ id: string }> {
  const suffix = randomUUID().slice(0, 8);
  const status = overrides.status ?? 'DRAFT';
  const result = await client.query(
    `INSERT INTO stock_counts (id, number, "countDate", status, "approvedAt", "updatedAt")
     VALUES ($1, $2, NOW(), $3::"CountStatus", $4, NOW())
     RETURNING id`,
    [randomUUID(), overrides.number ?? `CNT-TEST-${suffix}`, status, status === 'APPROVED' ? new Date() : null],
  );
  return result.rows[0];
}

export async function insertStockCountLine(
  client: Queryable,
  overrides: { stockCountId?: string; materialId?: string; systemQty?: number; countedQty?: number; differenceQty?: number } = {},
): Promise<{ id: string }> {
  const stockCountId = overrides.stockCountId ?? (await insertStockCount(client)).id;
  const materialId = overrides.materialId ?? (await insertMaterial(client)).id;
  const systemQty = overrides.systemQty ?? 0;
  const countedQty = overrides.countedQty ?? systemQty;
  const differenceQty = overrides.differenceQty ?? countedQty - systemQty;
  const result = await client.query(
    `INSERT INTO stock_count_lines (id, "stockCountId", "materialId", "systemQty", "countedQty", "differenceQty")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [randomUUID(), stockCountId, materialId, systemQty, countedQty, differenceQty],
  );
  return result.rows[0];
}

/**
 * The full-ledger-replay invariant: every IN movement minus every OUT
 * movement for a material, summed directly from stock_movements, must equal
 * stock_balances.quantity exactly. Shared by §1.3 (this phase) and, per
 * ARCHITECTURE.md's test-layout note, likely Phase 6's end-to-end scenarios.
 */
export async function assertLedgerReplayMatchesBalance(client: Queryable, materialId: string): Promise<void> {
  const ledgerResult = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN quantity ELSE -quantity END), 0) AS ledger_qty
     FROM stock_movements WHERE "materialId" = $1`,
    [materialId],
  );
  const balance = await getBalance(client, materialId);
  const ledgerQty = Number(ledgerResult.rows[0].ledger_qty);
  const balanceQty = Number(balance.quantity);
  if (Math.abs(ledgerQty - balanceQty) > 0.0001) {
    throw new Error(
      `assertLedgerReplayMatchesBalance: material ${materialId} — ledger sums to ${ledgerQty} but stock_balances.quantity is ${balanceQty}`,
    );
  }
}
