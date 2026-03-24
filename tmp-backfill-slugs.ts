/**
 * One-time backfill: populate SourceKennel.externalSlug from KennelDiscovery data.
 *
 * Run after `npx prisma db push` adds the externalSlug column.
 * Usage: npx tsx tmp-backfill-slugs.ts
 */
import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const hashregoSource = await prisma.source.findFirst({
    where: { type: "HASHREGO" },
    select: { id: true, name: true },
  });

  if (!hashregoSource) {
    console.log("No HASHREGO source found — nothing to backfill.");
    return;
  }

  console.log(`Found HASHREGO source: ${hashregoSource.name} (${hashregoSource.id})`);

  // Get all KennelDiscovery records matched to a kennel
  const discoveries = await prisma.kennelDiscovery.findMany({
    where: { externalSource: "HASHREGO", matchedKennelId: { not: null } },
    select: { externalSlug: true, matchedKennelId: true },
  });

  console.log(`Found ${discoveries.length} matched KennelDiscovery records`);

  let updated = 0;
  let skipped = 0;

  for (const d of discoveries) {
    const result = await prisma.sourceKennel.updateMany({
      where: {
        sourceId: hashregoSource.id,
        kennelId: d.matchedKennelId!,
        externalSlug: null,
      },
      data: { externalSlug: d.externalSlug },
    });

    if (result.count > 0) {
      updated++;
      console.log(`  + Set externalSlug="${d.externalSlug}" for kennelId=${d.matchedKennelId}`);
    } else {
      skipped++;
    }
  }

  // Report SourceKennel rows still missing slugs
  const missing = await prisma.sourceKennel.count({
    where: { sourceId: hashregoSource.id, externalSlug: null },
  });

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (already set or no SourceKennel row)`);
  if (missing > 0) {
    console.log(`⚠ ${missing} SourceKennel rows still have null externalSlug (no KennelDiscovery match)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
