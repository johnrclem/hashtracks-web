/**
 * Recompute Event.isCanonical across the existing row set.
 *
 * Needed once when the isCanonical flag ships: all prior rows default to
 * true, including duplicates that should be non-canonical. This script
 * walks every (kennelId, date) with more than one row, picks the winner
 * via the same pickCanonicalEventId selector the merge pipeline uses, and
 * flips the losers to isCanonical=false.
 *
 * Usage:
 *   npx tsx scripts/dedup-event-rows.ts            # dry run (default)
 *   npx tsx scripts/dedup-event-rows.ts --apply    # apply updates
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { pickCanonicalEventId } from "@/pipeline/merge";

const dryRun = !process.argv.includes("--apply");

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  // Group Events by (kennelId, date), keep only groups with >1 row.
  const dupGroups = await prisma.$queryRaw<{ kennelId: string; date: Date; cnt: bigint }[]>`
    SELECT "kennelId", date, COUNT(*) as cnt
    FROM "Event"
    GROUP BY "kennelId", date
    HAVING COUNT(*) > 1
  `;

  console.log(`Found ${dupGroups.length} (kennelId, date) slots with multiple rows.\n`);
  if (dupGroups.length === 0) {
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  let flipped = 0;
  let unchanged = 0;
  for (const group of dupGroups) {
    const events = await prisma.event.findMany({
      where: { kennelId: group.kennelId, date: group.date },
      select: {
        id: true, trustLevel: true, createdAt: true, isCanonical: true,
        title: true, haresText: true, locationName: true, locationStreet: true,
        locationCity: true, locationAddress: true, latitude: true, longitude: true,
        startTime: true, endTime: true, cost: true, sourceUrl: true,
        runNumber: true, description: true,
      },
    });

    const canonicalId = pickCanonicalEventId(events);
    if (canonicalId == null) continue;

    const toDemote = events.filter(e => e.id !== canonicalId && e.isCanonical);
    const toPromote = events.find(e => e.id === canonicalId && !e.isCanonical);

    if (toDemote.length === 0 && !toPromote) {
      unchanged++;
      continue;
    }

    if (!dryRun) {
      await prisma.$transaction([
        prisma.event.update({
          where: { id: canonicalId },
          data: { isCanonical: true },
        }),
        prisma.event.updateMany({
          where: { id: { in: toDemote.map(e => e.id) } },
          data: { isCanonical: false },
        }),
      ]);
    }
    flipped += toDemote.length + (toPromote ? 1 : 0);
    console.log(
      `  ${dryRun ? "would" : "did"} flip ${toDemote.length} row(s) → non-canonical ` +
      `(canonical=${canonicalId.slice(0, 8)}…, kennel=${group.kennelId.slice(0, 8)}…, date=${group.date.toISOString().slice(0, 10)})`,
    );
  }

  console.log(`\n✓ ${flipped} row flag(s) ${dryRun ? "would be" : ""} updated across ${dupGroups.length} dup slots (${unchanged} already correct).`);

  await prisma.$disconnect();
  await pool.end();
}

const entryPoint = process.argv[1] ?? "";
if (entryPoint.endsWith("dedup-event-rows.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
