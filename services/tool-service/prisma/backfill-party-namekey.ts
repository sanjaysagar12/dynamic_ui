/**
 * One-off: fills Party.nameKey for parties created before it existed, and reports duplicates.
 * Safe to run more than once. Runs against whatever DATABASE_URL points at.
 *
 *   npx tsx prisma/backfill-party-namekey.ts           → report only, changes nothing
 *   npx tsx prisma/backfill-party-namekey.ts --apply   → writes the keys
 *
 * Parties that normalize to the same key are the SAME business entered twice (e.g.
 * "Sundaram Ferrites" and "Sundaram Ferrites Pvt Ltd"). Only the oldest one gets the key;
 * the others are listed and left with no key so the unique index doesn't break. Merge them
 * by hand (move their POs/receipts/jobs to the kept party, then deactivate the extra), then
 * run this again.
 *
 * Also lists names that look like they have a city folded in ("Sundaram Ferrites, Chennai")
 * — fix those with update_party.
 */
import { PrismaClient } from '@prisma/client';
import { partyNameKey } from '../src/lib/partyName.js';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const parties = await prisma.party.findMany({ orderBy: { createdAt: 'asc' } });
  const byKey = new Map<string, typeof parties>();
  for (const p of parties) {
    const key = partyNameKey(p.name);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }

  let written = 0;
  const duplicates: string[] = [];
  for (const [key, group] of byKey) {
    const [keep, ...extras] = group;
    if (extras.length) {
      duplicates.push(`  "${keep.name}" (kept) ← also entered as: ${extras.map((e) => `"${e.name}"`).join(', ')}`);
    }
    if (keep.nameKey !== key) {
      if (apply) {
        const taken = await prisma.party.findFirst({ where: { nameKey: key, NOT: { id: keep.id } } });
        if (!taken) {
          await prisma.party.update({ where: { id: keep.id }, data: { nameKey: key } });
          written++;
        }
      } else {
        written++;
      }
    }
  }

  const cityInName = parties.filter((p) => /,\s*[A-Za-z .]+$/.test(p.name));

  console.log(`${parties.length} parties checked.`);
  console.log(`${apply ? 'Set' : 'Would set'} nameKey on ${written}.`);
  if (duplicates.length) {
    console.log(`\nDUPLICATES — same business entered more than once (merge by hand):`);
    duplicates.forEach((d) => console.log(d));
  }
  if (cityInName.length) {
    console.log(`\nNames that may have a city in them (fix with update_party):`);
    cityInName.forEach((p) => console.log(`  "${p.name}"`));
  }
  if (!apply) console.log(`\nNothing was changed. Run with --apply to write.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
