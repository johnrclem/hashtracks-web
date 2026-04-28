import "dotenv/config";
import { prisma } from "@/lib/db";

/**
 * Post-deploy verification for the EventKennel backfill (issue #1023, step 1).
 * Asserts: total ≥ event count, exactly one primary per event, partial unique
 * index exists, primary EventKennel.kennelId matches Event.kennelId.
 *
 * Run: `npx tsx scripts/verify-event-kennel-backfill.ts` — exits non-zero on
 * any failure so CI / on-call can gate on it.
 */
const PARTIAL_UNIQUE_INDEX_NAME = "EventKennel_eventId_isPrimary_unique";

async function main() {
  const [eventCount, ekTotal, ekPrimary] = await Promise.all([
    prisma.event.count(),
    prisma.eventKennel.count(),
    prisma.eventKennel.count({ where: { isPrimary: true } }),
  ]);

  console.log(`Event count:           ${eventCount.toLocaleString()}`);
  console.log(`EventKennel total:     ${ekTotal.toLocaleString()}`);
  console.log(`EventKennel primaries: ${ekPrimary.toLocaleString()}`);

  if (ekTotal < eventCount) {
    throw new Error(
      `EventKennel total (${ekTotal}) below Event count (${eventCount}) — backfill incomplete`,
    );
  }

  if (ekPrimary !== eventCount) {
    throw new Error(
      `Primary count mismatch: ${ekPrimary} primaries vs ${eventCount} events — every event must have exactly one primary`,
    );
  }

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

  console.log("\nAll invariants hold ✓");
}

main()
  .catch((err) => {
    console.error("\nVerification failed:");
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
