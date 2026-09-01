import type { Party, Prisma } from '@prisma/client';
import { nextNumber } from './numberSeries.js';

export type PartyRole = 'customer' | 'supplier';

/**
 * Finds-or-creates a Party by name for the given role. Vijaya's suppliers
 * and customers share one Party table (isSupplier/isCustomer flags) rather
 * than separate models — a name match under the *other* role is promoted
 * (the missing flag is set) rather than creating a second Party row for the
 * same real-world business.
 *
 * Must run inside the caller's own transaction: creating a brand-new party
 * mints a PTY-#### code via nextNumber, which itself requires a transaction
 * client for its atomic upsert.
 */
export async function resolveOrCreateByName(tx: Prisma.TransactionClient, role: PartyRole, name: string): Promise<Party> {
  const roleFlag = role === 'customer' ? { isCustomer: true } : { isSupplier: true };

  const matchingRole = await tx.party.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...roleFlag },
  });
  if (matchingRole) return matchingRole;

  const sameName = await tx.party.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (sameName) {
    return tx.party.update({ where: { id: sameName.id }, data: roleFlag });
  }

  const code = await nextNumber(tx, 'PTY');
  return tx.party.create({ data: { code, name, ...roleFlag } });
}
