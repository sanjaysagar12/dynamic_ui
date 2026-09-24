import { Prisma } from '@prisma/client';
import { ToolError } from './toolError.js';

export interface TranslatedError {
  error: string;
  code: string;
}

// Keyed by `${PrismaClientKnownRequestError.code}:${constraint/target name}`
// so a later batch (guard_count_adjustment, reversalOfId, ...) is just
// another map entry, not a restructure. A `${code}` entry with no
// constraint suffix acts as a fallback for that Prisma error code generally.
//
// The constraint-name suffix is the field list Prisma's own `meta.target`
// actually reports for a unique-constraint violation (this Prisma client
// version reports field names, e.g. "customerId,number" — NOT the
// underlying Postgres constraint name, e.g. "customer_pos_customerId_
// number_key" — verified empirically in translate-prisma-error.test.ts;
// don't guess this shape from the SQL migration's constraint name).
const PRISMA_ERROR_MAP = new Map<string, TranslatedError>([
  // populated in later batches, e.g.:
  // ['P2002:code', { error: 'Material code already exists', code: 'DUPLICATE_CODE' }],
  [
    'P2002:customerId,number',
    { error: 'A PO with this number already exists for this customer', code: 'DUPLICATE_CUSTOMER_PO' },
  ],
  [
    'P2002:nameKey',
    { error: 'A supplier or customer with this name already exists', code: 'DUPLICATE_PARTY' },
  ],
  [
    'P2002:gstin',
    { error: 'A supplier or customer with this GSTIN already exists', code: 'DUPLICATE_GSTIN' },
  ],
  [
    'P2002:reversalOfId',
    { error: 'This movement has already been reversed', code: 'ALREADY_REVERSED' },
  ],
]);

// A Postgres CHECK constraint violation (SQLSTATE 23514) does NOT come back
// as a PrismaClientKnownRequestError at all — Prisma surfaces it as a
// PrismaClientUnknownRequestError with no structured `.code`/`.meta`, only a
// raw message containing the underlying Postgres error text (confirmed
// empirically; see translate-prisma-error.test.ts). The constraint name is
// only recoverable by pattern-matching that message, so CHECK-constraint
// violations get their own map, keyed by the constraint's real SQL name
// (inventory_guards.sql), separate from PRISMA_ERROR_MAP's P-code keys.
const CHECK_CONSTRAINT_MAP = new Map<string, TranslatedError>([
  [
    'chk_grn_split',
    { error: 'acceptedQty + rejectedQty must equal receivedQty for every line', code: 'SPLIT_MISMATCH' },
  ],
]);

// The underlying Rust connector's debug-formatted error is embedded verbatim
// in PrismaClientUnknownRequestError's .message — confirmed empirically, its
// quoting is a mix of the Rust struct's own escaped inner string PLUS the
// JS message's own outer quoting around that, so the exact run of `\`/`"`
// characters around the constraint name isn't worth parsing precisely.
// Postgres constraint names here are always plain lowercase snake_case
// identifiers (inventory_guards.sql) — matching the identifier itself,
// regardless of what quote/backslash characters surround it, is robust to
// that formatting rather than guessing its exact escaping.
const CHECK_CONSTRAINT_MESSAGE_RE = /violates check constraint\W+([a-z][a-z0-9_]*)/;

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
  // Business-rule failures thrown on purpose by shared helpers carry their own code and
  // plain-language message — pass them through untouched.
  if (err instanceof ToolError) return { error: err.message, code: err.code };

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const target = constraintKey(err);
    const hit = (target && PRISMA_ERROR_MAP.get(`${err.code}:${target}`)) ?? PRISMA_ERROR_MAP.get(err.code);
    if (hit) return hit;
  } else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const match = CHECK_CONSTRAINT_MESSAGE_RE.exec(err.message);
    const hit = match && CHECK_CONSTRAINT_MAP.get(match[1]);
    if (hit) return hit;
  }

  console.error('Unhandled Prisma/DB error:', err);
  return { error: 'Internal error', code: 'INTERNAL_ERROR' };
}
