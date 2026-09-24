import type { Party, PrismaClient, Prisma } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

// Words that don't distinguish one business from another. Stripped from the END of a name
// (repeatedly), so "Sundaram Ferrites Pvt. Ltd." and "Sundaram Ferrites" get the same key.
// Deliberately NOT stripped: words like "industries", "traders", "electricals" — two
// different businesses can differ only by those.
const TRAILING_NOISE = [
  'private limited',
  'pvt ltd',
  'pvt',
  'private',
  'limited',
  'ltd',
  'llp',
  'and co',
  'co',
  'company',
  'corporation',
  'corp',
  'inc',
];

/**
 * The key two party names are compared by. Same key = same business.
 *   "Sundaram Ferrites"            → "sundaramferrites"
 *   "M/s. Sundaram Ferrites Pvt Ltd" → "sundaramferrites"
 *   "SUNDARAM  FERRITES."          → "sundaramferrites"
 * Stored in Party.nameKey (unique), so the database itself refuses an exact duplicate.
 * prisma/backfill-party-namekey.ts uses this same function — never reimplement it in SQL.
 */
export function partyNameKey(name: string): string {
  let s = name.normalize('NFKD').toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/^\s*m\s*\/\s*s\b\.?/, ' '); // "M/s", "M/s."
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const word of TRAILING_NOISE) {
      if (s === word) continue; // never strip a name down to nothing
      if (s.endsWith(` ${word}`)) {
        s = s.slice(0, -word.length - 1).trim();
        changed = true;
      }
    }
  }
  return s.replace(/ /g, '');
}

/** Tidy the display name: trim, collapse spaces. Keeps the user's own capitalisation. */
export function cleanPartyName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Uppercase and strip spaces. Returns null for empty input. */
export function normalizeGstin(gstin: string | undefined | null): string | null {
  if (!gstin) return null;
  const g = gstin.replace(/\s+/g, '').toUpperCase();
  return g === '' ? null : g;
}

export function isValidGstin(gstin: string): boolean {
  return GSTIN_RE.test(gstin);
}

/**
 * Parties whose key contains this key, or is contained in it — catches
 * "Sundaram Ferrites, Chennai" vs "Sundaram Ferrites", and "Sundaram Ferrite" vs
 * "Sundaram Ferrites". Keys shorter than 4 characters are too generic to compare.
 * If genuinely different wordings slip through in testing, the next step is pg_trgm
 * similarity — not more rules here.
 */
export async function findSimilarParties(db: Db, key: string, excludeId?: string): Promise<Party[]> {
  if (key.length < 4) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM parties
    WHERE "nameKey" IS NOT NULL
      AND "isActive" = true
      AND length("nameKey") >= 4
      AND ("nameKey" LIKE '%' || ${key} || '%' OR position("nameKey" IN ${key}) > 0)
  `;
  const ids = rows.map((r) => r.id).filter((id) => id !== excludeId);
  if (ids.length === 0) return [];
  return db.party.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } });
}

/** What the agent and forms may see about a party. Never includes the internal code. */
export function publicParty(p: Party) {
  return {
    id: p.id,
    name: p.name,
    label: p.city ? `${p.name} (${p.city})` : p.name,
    city: p.city,
    state: p.state,
    gstin: p.gstin,
    phone: p.phone,
    email: p.email,
    isSupplier: p.isSupplier,
    isCustomer: p.isCustomer,
    type: p.isSupplier && p.isCustomer ? 'Supplier & customer' : p.isSupplier ? 'Supplier' : p.isCustomer ? 'Customer' : '—',
    isActive: p.isActive,
  };
}
