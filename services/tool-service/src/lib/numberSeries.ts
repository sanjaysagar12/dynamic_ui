import type { Prisma } from '@prisma/client';

/**
 * Allocates the next human-readable document number for a doc type,
 * atomically incrementing NumberSeries.lastNumber via a single upsert — no
 * read-then-increment in application code, so two concurrent calls can
 * never produce the same number. Must run inside the caller's own
 * transaction (the same one that inserts the row this number is for), so a
 * failed insert also rolls back the number bump.
 *
 * fiscalYear is '' for doc types with no FY component (this batch only
 * wires up MAT-####, per the catalog doc — later batches pass a real FY
 * for JOB-<FY>-####/PO-<FY>-####/GRN-<FY>-####), matching the unique
 * constraint on (docType, financialYear).
 */
export async function nextNumber(tx: Prisma.TransactionClient, prefix: string, fiscalYear = ''): Promise<string> {
  const rows = await tx.$queryRaw<{ lastNumber: number; padding: number }[]>`
    INSERT INTO number_series (id, "docType", prefix, "financialYear", "lastNumber", padding)
    VALUES (gen_random_uuid()::text, ${prefix}, ${prefix}, ${fiscalYear}, 1, 4)
    ON CONFLICT ("docType", "financialYear")
    DO UPDATE SET "lastNumber" = number_series."lastNumber" + 1
    RETURNING "lastNumber", padding
  `;

  const { lastNumber, padding } = rows[0];
  const padded = String(lastNumber).padStart(padding, '0');
  return fiscalYear ? `${prefix}-${fiscalYear}-${padded}` : `${prefix}-${padded}`;
}
