import { Prisma } from '@prisma/client';

export interface TranslatedError {
  error: string;
  code: string;
}

// Keyed by `${PrismaClientKnownRequestError.code}:${constraint/target name}`
// so a later batch (chk_grn_split, guard_count_adjustment, reversalOfId, ...)
// is just another map entry, not a restructure. A `${code}` entry with no
// constraint suffix acts as a fallback for that Prisma error code generally.
const PRISMA_ERROR_MAP = new Map<string, TranslatedError>([
  // populated in later batches, e.g.:
  // ['P2002:materials_code_key', { error: 'Material code already exists', code: 'DUPLICATE_CODE' }],
  [
    'P2002:customer_pos_customerId_number_key',
    { error: 'A PO with this number already exists for this customer', code: 'DUPLICATE_CUSTOMER_PO' },
  ],
]);

function constraintKey(err: Prisma.PrismaClientKnownRequestError): string | undefined {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.join(',');
  if (typeof target === 'string') return target;
  if (typeof err.meta?.constraint === 'string') return err.meta.constraint;
  return undefined;
}

/**
 * Maps a Prisma/Postgres error to one of the doc's named { error, code }
 * shapes. Every tool handler must run its caught Prisma errors through this
 * before returning a ToolResult — a raw Prisma exception must never escape a
 * handler. Unrecognized errors get a generic fallback; the real error is
 * always logged server-side, never leaked to the caller verbatim.
 */
export function translatePrismaError(err: unknown): TranslatedError {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const target = constraintKey(err);
    const hit = (target && PRISMA_ERROR_MAP.get(`${err.code}:${target}`)) ?? PRISMA_ERROR_MAP.get(err.code);
    if (hit) return hit;
  }

  console.error('Unhandled Prisma/DB error:', err);
  return { error: 'Internal error', code: 'INTERNAL_ERROR' };
}
