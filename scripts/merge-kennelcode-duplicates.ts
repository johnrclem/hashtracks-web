/**
 * One-time script: Merge duplicate kennels created during kennelCode migration.
 *
 * Problem: Seed upserted on shortName (old), creating new records with correct
 * kennelCodes alongside old records that had events. This script:
 * 1. Deletes the empty duplicate records (with their aliases, source links, roster links)
 * 2. Updates the event-bearing records to have the correct kennelCode/shortName/slug
 * 3. After this, `npx prisma db seed` will match on kennelCode and finalize everything.
 *
 * Usage:
 *   npx tsx scripts/merge-kennelcode-duplicates.ts --dry-run
 *   npx tsx scripts/merge-kennelcode-duplicates.ts
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

interface MergePair {
  /** Record to DELETE (empty duplicate) */
  deleteId: string;
  deleteCode: string;
  /** Record to KEEP (has events/data) — update its kennelCode/shortName/slug */
  keepId: string;
  keepCode: string;
  /** New values for the kept record */
  newCode: string;
  newShortName: string;
  newSlug: string;
}

const MERGE_PAIRS: MergePair[] = [
  {
    // Queens (4 events) → rename to QBK, delete empty QBK record
    deleteId: "cmlreg41w00057tm9ydbo2aej",
    deleteCode: "qbk",
    keepId: "cmljzsdqi0005vam9w4amldkz",
    keepCode: "queens",
    newCode: "qbk",
    newShortName: "QBK",
    newSlug: "qbk",
  },
  {
    // Pink Taco (Boston) (4 events, 1 member) → rename to Pink Taco, delete empty Pink Taco
    deleteId: "cmlreg4jq000g7tm9mnpqw39m",
    deleteCode: "pink-taco",
    keepId: "cmlehnxch000g9cm95mnh3nwr",
    keepCode: "pink-taco-boston-",
    newCode: "pink-taco",
    newShortName: "Pink Taco",
    newSlug: "pink-taco",
  },
  {
    // Brooklyn (36 events, 1 member, 21 hashers) → rename to BrH3, delete empty BrH3
    deleteId: "cmlreg3y600017tm9z1mpt7za",
    deleteCode: "brh3",
    keepId: "cmljzsdkv0001vam9j5ewrllf",
    keepCode: "brooklyn",
    newCode: "brh3",
    newShortName: "BrH3",
    newSlug: "brh3",
  },
  {
    // New Amsterdam (8 events, 9 hashers) → rename to NAH3, delete empty NAH3
    deleteId: "cmlreg3z600027tm9q8cu5tdp",
    deleteCode: "nah3",
    keepId: "cmlehnx0100029cm9had8x7he",
    keepCode: "new-amsterdam",
    newCode: "nah3",
    newShortName: "NAH3",
    newSlug: "nah3",
  },
  {
    // CH3 has 160 events on correct code — just delete empty Chicago H3
    deleteId: "cmlehnxfk000k9cm9kx458woj",
    deleteCode: "chicago-h3",
    keepId: "cmlreg4pa000n7tm9yqbinife",
    keepCode: "ch3",
    newCode: "ch3",
    newShortName: "CH3",
    newSlug: "ch3",
  },
  {
    // Boston H3 (92 events, 1 member, 103 hashers) → rename to BoH3, delete empty BoH3
    deleteId: "cmlreg4fe000c7tm938nujw01",
    deleteCode: "boh3",
    keepId: "cmlehnx9c000c9cm9c6zrjszk",
    keepCode: "boston-h3",
    newCode: "boh3",
    newShortName: "BoH3",
    newSlug: "boh3",
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  console.log(dryRun ? "\n[DRY RUN] No changes will be made.\n" : "\n[LIVE] Merging duplicate kennels...\n");

  for (const pair of MERGE_PAIRS) {
    console.log(`--- ${pair.keepCode} → ${pair.newCode} (delete ${pair.deleteCode}) ---`);

    // Verify both records exist
    const toDelete = await prisma.kennel.findUnique({ where: { id: pair.deleteId }, select: { id: true, kennelCode: true, shortName: true } });
    const toKeep = await prisma.kennel.findUnique({ where: { id: pair.keepId }, select: { id: true, kennelCode: true, shortName: true } });

    if (!toDelete) {
      console.log(`  SKIP: Delete target (${pair.deleteCode}) not found — already cleaned up?`);
      continue;
    }
    if (!toKeep) {
      console.log(`  SKIP: Keep target (${pair.keepCode}) not found — unexpected!`);
      continue;
    }

    console.log(`  DELETE: ${toDelete.kennelCode} "${toDelete.shortName}" (id=${toDelete.id})`);
    console.log(`  KEEP:   ${toKeep.kennelCode} "${toKeep.shortName}" (id=${toKeep.id}) → code=${pair.newCode}, name="${pair.newShortName}", slug="${pair.newSlug}"`);

    if (dryRun) continue;

    // Execute in transaction: delete empty dupe first, then update kept record
    await prisma.$transaction(async (tx) => {
      // 1. Delete related records on the empty duplicate
      await tx.kennelAlias.deleteMany({ where: { kennelId: pair.deleteId } });
      await tx.sourceKennel.deleteMany({ where: { kennelId: pair.deleteId } });
      await tx.rosterGroupKennel.deleteMany({ where: { kennelId: pair.deleteId } });
      await tx.kennelHasher.deleteMany({ where: { kennelId: pair.deleteId } });
      await tx.kennelHasherLink.deleteMany({ where: { kennelHasher: { kennelId: pair.deleteId } } });
      await tx.userKennel.deleteMany({ where: { kennelId: pair.deleteId } });
      await tx.mismanRequest.deleteMany({ where: { kennelId: pair.deleteId } });

      // 2. Delete the empty kennel record
      await tx.kennel.delete({ where: { id: pair.deleteId } });

      // 3. Update the kept record with correct identity
      if (pair.keepCode !== pair.newCode) {
        await tx.kennel.update({
          where: { id: pair.keepId },
          data: {
            kennelCode: pair.newCode,
            shortName: pair.newShortName,
            slug: pair.newSlug,
          },
        });
      }
    });

    console.log("  DONE ✓");
  }

  // Verify: check for remaining duplicates
  const remaining = await prisma.$queryRaw<Array<{ fullName: string; cnt: bigint }>>`
    SELECT "fullName", COUNT(*) as cnt FROM "Kennel" GROUP BY "fullName" HAVING COUNT(*) > 1
  `;
  if (remaining.length === 0) {
    console.log("\n✓ No duplicate fullNames remaining.");
  } else {
    console.warn("\n⚠ Remaining duplicates:");
    for (const d of remaining) {
      console.warn(`  - "${d.fullName}" (${d.cnt} records)`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
