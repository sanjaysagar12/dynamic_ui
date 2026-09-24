import type { Party, Prisma, PrismaClient } from '@prisma/client';
import { ToolError } from './toolError.js';
import { findSimilarParties, partyNameKey } from './partyName.js';

export type PartyRole = 'customer' | 'supplier';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Finds an EXISTING active party by name for a role. Never creates one.
 *
 * Replaces resolveOrCreateByName. Creating parties as a side effect of a purchase order or
 * customer PO produced suppliers with no GSTIN, the city folded into the name ("Sundaram
 * Ferrites, Chennai"), and a new duplicate for every spelling. Parties are now created only
 * through create_party, once, with their details.
 *
 * Matching is by normalized name (see partyNameKey), so "Sundaram Ferrites Pvt Ltd" finds
 * "Sundaram Ferrites".
 *
 * Throws ToolError:
 *  - PARTY_NOT_FOUND   no match; message suggests similar names if any, else create_party
 *  - PARTY_WRONG_ROLE  found, but not marked as this role; update_party can add it
 */
export async function resolvePartyByName(db: Db, role: PartyRole, name: string): Promise<Party> {
  const key = partyNameKey(name);
  const roleWord = role === 'supplier' ? 'supplier' : 'customer';

  const party = await db.party.findFirst({ where: { nameKey: key, isActive: true } });

  if (party) {
    const hasRole = role === 'supplier' ? party.isSupplier : party.isCustomer;
    if (!hasRole) {
      throw new ToolError(
        'PARTY_WRONG_ROLE',
        `${party.name} is saved as a ${role === 'supplier' ? 'customer' : 'supplier'}, not a ${roleWord}. ` +
          `Mark them as a ${roleWord} too (update_party), then try again.`,
      );
    }
    return party;
  }

  const similar = await findSimilarParties(db, key);
  if (similar.length > 0) {
    throw new ToolError(
      'PARTY_NOT_FOUND',
      `No ${roleWord} called "${name}". Did you mean: ${similar.map((p) => p.name).join(', ')}?`,
    );
  }
  throw new ToolError(
    'PARTY_NOT_FOUND',
    `No ${roleWord} called "${name}" yet. Add them first (create_party) with their GSTIN and city.`,
  );
}
