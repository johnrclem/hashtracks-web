import "dotenv/config";
import { prisma } from "@/lib/db";

/**
 * Post-deploy verification for the EventKennel backfill (issue #1023).
 *
 * Hard assertions (throw on failure):
 *   - Partial unique index `EventKennel_eventId_isPrimary_unique` exists.
 *   - No drift between primary EventKennel.kennelId and Event.kennelId.
 *   - Every Event has exactly one primary EventKennel row.
 *
 * If the third check fails, run
 * `scripts/reconcile-missing-event-kennel-primaries.ts --apply` to backfill
 * the missing rows (Event.kennelId is the source of truth) and then re-run
 * this verifier. The reconciler exists because step-1's migration backfill
 * only covered Events that existed at migration deploy time — Events created
 * between migration deploy and step-2 (dual-write) deploy were not picked up.
 * After step 2 shipped, the merge pipeline writes both sides atomically, so
 * any new orphan signals a real bug (a write path bypassing
 * `createEventWithKennel`, or a row deletion).
 *
 * Run: `npx tsx scripts/verify-event-kennel-backfill.ts` — exits non-zero
 * on any failure.
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

  if (ekPrimary < eventCount) {
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
    const sampleList = missing.map(({ id }) => `  ${id}`).join("\n");
    throw new Error(
      `${gap} event(s) missing a primary EventKennel row — first ${missing.length}:\n${sampleList}\n\n` +
        `Run \`npx tsx scripts/reconcile-missing-event-kennel-primaries.ts --apply\` to backfill, ` +
        `then investigate which write path created Events without going through createEventWithKennel.`,
    );
  }

  if (ekPrimary > eventCount) {
    // Structurally impossible given the FK from EventKennel.eventId →
    // Event.id (ON DELETE CASCADE) plus the partial unique index that caps
    // primaries at one per event. If we hit this branch, one of those
    // invariants has been compromised — point at that, not the reconciler.
    throw new Error(
      `Primary EventKennel rows (${ekPrimary}) exceed Event rows (${eventCount}) — ` +
        `the FK + partial unique index should make this impossible. Investigate index/constraint state ` +
        `(\\d "EventKennel" in psql) and any direct DB writes that bypass Prisma before reconciling.`,
    );
  }

  console.log("\nAll invariants hold ✓");
}

main()
  .catch((err) => {
    console.error("\nVerification failed:");
    console.error(err.message);
    // Set exitCode (don't `process.exit` synchronously) so `.finally` runs
    // and `prisma.$disconnect()` resolves before the process exits.
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
