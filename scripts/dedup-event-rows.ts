/**
 * Recompute Event.isCanonical for any (kennelId, date) with >1 row.
 * Uses the same pickCanonicalEventId selector as the merge pipeline so
 * re-runs and re-scrapes converge on identical flags.
 *
 * Usage:
 *   npx tsx scripts/dedup-event-rows.ts            # dry run (default)
 *   npx tsx scripts/dedup-event-rows.ts --apply    # apply updates
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { pickCanonicalEventIds } from "@/pipeline/merge";

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

    const canonicalIds = pickCanonicalEventIds(events);
    if (canonicalIds.size === 0) continue;

    const toDemote = events.filter(e => !canonicalIds.has(e.id) && e.isCanonical);
    const toPromote = events.filter(e => canonicalIds.has(e.id) && !e.isCanonical);

    if (toDemote.length === 0 && toPromote.length === 0) {
      unchanged++;
      continue;
    }

    if (!dryRun) {
      const ops = [];
      if (toPromote.length > 0) {
        ops.push(
          prisma.event.updateMany({
            where: { id: { in: toPromote.map(e => e.id) } },
            data: { isCanonical: true },
          }),
        );
      }
      if (toDemote.length > 0) {
        ops.push(
          prisma.event.updateMany({
            where: { id: { in: toDemote.map(e => e.id) } },
            data: { isCanonical: false },
          }),
        );
      }
      await prisma.$transaction(ops);
    }
    flipped += toDemote.length + toPromote.length;
    console.log(
      `  ${dryRun ? "would" : "did"} flip ${toDemote.length} → non-canonical, ${toPromote.length} → canonical ` +
      `(kennel=${group.kennelId.slice(0, 8)}…, date=${group.date.toISOString().slice(0, 10)}, canonical-count=${canonicalIds.size})`,
    );
  }

  console.log(`\n✓ ${flipped} row flag(s) ${dryRun ? "would be" : "were"} updated across ${dupGroups.length} dup slots (${unchanged} already correct).`);

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
