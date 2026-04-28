import "dotenv/config";
import { prisma } from "@/lib/db";

/**
 * Post-deploy verification for the EventKennel backfill (issue #1023, step 1).
 *
 * Hard assertions (throw on failure): partial unique index exists, no drift
 * between primary EventKennel.kennelId and Event.kennelId.
 *
 * Soft check (warn, do not throw): every Event has exactly one primary
 * EventKennel row. Until step 2 (dual-write) ships, new Events written via
 * the existing single-FK code path won't have an EventKennel row — that gap
 * is expected during the rollout window. The script logs up to 25 missing
 * Event IDs so on-call can spot-check whether they're recent (gap-window) or
 * old (real backfill bug).
 *
 * TODO(#1023 step 2): once dual-write ships, restore the strict equality
 * assertion `ekPrimary === eventCount` as a hard throw.
 *
 * Run: `npx tsx scripts/verify-event-kennel-backfill.ts` — exits non-zero
 * only when a hard assertion fails.
 */
const PARTIAL_UNIQUE_INDEX_NAME = "EventKennel_eventId_isPrimary_unique";
const MISSING_ID_SAMPLE = 25;

async function main() {
  const [eventCount, ekTotal, ekPrimary] = await Promise.all([
    prisma.event.count(),
    prisma.eventKennel.count(),
    prisma.eventKennel.count({ where: { isPrimary: true } }),
  ]);

  console.log(`Event count:           ${eventCount.toLocaleString()}`);
  console.log(`EventKennel total:     ${ekTotal.toLocaleString()}`);
  console.log(`EventKennel primaries: ${ekPrimary.toLocaleString()}`);

  const idx = await prisma.$queryRaw<unknown[]>`
    SELECT 1 FROM pg_indexes WHERE indexname = ${PARTIAL_UNIQUE_INDEX_NAME}
  `;
  if (!Array.isArray(idx) || idx.length === 0) {
    throw new Error(
      `Partial unique index '${PARTIAL_UNIQUE_INDEX_NAME}' not found — single-primary invariant unenforced`,
    );
  }
  console.log("Partial unique index:  present");

  const drift = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Event" e
    JOIN "EventKennel" ek ON ek."eventId" = e.id AND ek."isPrimary" = true
    WHERE ek."kennelId" <> e."kennelId"
  `;
  const driftCount = Number(drift[0]?.count ?? 0);
  if (driftCount > 0) {
    throw new Error(
      `${driftCount} events have a primary EventKennel.kennelId that does not match Event.kennelId — denorm pointer is stale`,
    );
  }
  console.log("Denorm/join sync:      OK (no drift)");

  if (ekPrimary !== eventCount) {
    const gap = eventCount - ekPrimary;
    const missing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT e.id
      FROM "Event" e
      WHERE NOT EXISTS (
        SELECT 1 FROM "EventKennel" ek
        WHERE ek."eventId" = e.id AND ek."isPrimary" = true
      )
      LIMIT ${MISSING_ID_SAMPLE}
    `;
    console.warn(
      `\nWARN: ${gap} event(s) missing a primary EventKennel row. Expected during the rollout window between step 1 and step 2 (dual-write); investigate if these are old IDs (pre-backfill).`,
    );
    console.warn(`First ${missing.length} missing event IDs:`);
    for (const { id } of missing) console.warn(`  ${id}`);
    console.log("\nHard assertions passed (count gap is expected pre-step-2)");
    return;
  }

  console.log("\nAll invariants hold ✓");
}

main()
  .catch((err) => {
    console.error("\nVerification failed:");
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
