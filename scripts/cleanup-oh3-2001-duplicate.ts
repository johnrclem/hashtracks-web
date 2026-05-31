/**
 * One-shot: collapse the OH3 Run #2001 cross-endpoint duplicate — issue #1828.
 *
 * oh3.no/calendar.ics publishes the same run on two endpoints: a timed
 * /runs/28368 VEVENT (#2001, 18:30, but a stub hare "Mismanagement") and an
 * all-day /events/24 VEVENT (no #, but the authoritative hares "Altar Boy & Hot
 * Shit" + rich description). Pre-fix they merged into TWO canonical Events on
 * 2026-06-15. The adapter now coalesces them at ingest; this script repairs the
 * already-persisted pair:
 *   1. heal the timed /runs/ survivor's hares from the /events/ twin, and
 *   2. delete the all-day /events/ ghost (+ its EventHare/RawEvents).
 *
 * Signature-based + idempotent (re-query by kennel+date+endpoint, never a
 * hard-coded id). DURABILITY NOTE: run this AFTER the coalescing code is
 * deployed and the OH3 source config (coalesceEndpointDuplicates) is seeded —
 * otherwise an old-code cron re-ingests /events/24 and re-creates the ghost.
 *
 *   set -a && source ../<main>/.env && set +a   # prod DATABASE_URL
 *   npx tsx scripts/cleanup-oh3-2001-duplicate.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const RUNS_RE = /\/runs\/\d+/i;
const EVENTS_RE = /\/events\/\d+/i;

type RawData = { sourceUrl?: string; hares?: string; runNumber?: number };

async function main() {
  const events = await prisma.event.findMany({
    where: {
      eventKennels: { some: { kennel: { kennelCode: "oh3-no" } } },
      dateUtc: { gte: new Date("2026-06-15T00:00:00Z"), lt: new Date("2026-06-16T00:00:00Z") },
    },
    select: {
      id: true, runNumber: true, startTime: true, title: true, haresText: true, status: true,
      rawEvents: { select: { id: true, rawData: true } },
    },
  });

  const endpointsOf = (e: (typeof events)[number]) =>
    e.rawEvents.map((r) => (r.rawData as RawData).sourceUrl ?? "");

  // Survivor: the timed /runs/ event with the real run number 2001.
  const survivor = events.find(
    (e) => e.runNumber === 2001 && endpointsOf(e).some((u) => RUNS_RE.test(u)),
  );
  // Ghost: an /events/-only event with no run number (the all-day duplicate).
  const ghost = events.find(
    (e) => e.id !== survivor?.id && e.runNumber == null && endpointsOf(e).every((u) => EVENTS_RE.test(u)),
  );

  if (!survivor) {
    console.error("✗ No /runs/ survivor (runNumber 2001) found on 2026-06-15. Aborting.");
    process.exit(1);
  }
  if (!ghost) {
    console.log("✓ No /events/ ghost found — already coalesced. Nothing to do.");
    return;
  }
  // Guard (memory: real runNumber ≠ phantom): never delete a row carrying a run number.
  if (ghost.runNumber != null) {
    console.error(`✗ Candidate ghost ${ghost.id} carries runNumber ${ghost.runNumber} — refusing to delete.`);
    process.exit(1);
  }

  const healedHares = ghost.haresText ?? survivor.haresText;
  console.log(`Survivor: ${survivor.id} #${survivor.runNumber} t=${survivor.startTime} hares="${survivor.haresText}"`);
  console.log(`Ghost:    ${ghost.id} [all-day] hares="${ghost.haresText}" rawEvents=${ghost.rawEvents.length}`);
  console.log(`→ heal survivor hares → "${healedHares}", delete ghost.`);

  await prisma.$transaction(async (tx) => {
    if (healedHares && healedHares !== survivor.haresText) {
      await tx.event.update({ where: { id: survivor.id }, data: { haresText: healedHares } });
    }
    await tx.eventHare.deleteMany({ where: { eventId: ghost.id } });
    await tx.rawEvent.deleteMany({ where: { eventId: ghost.id } });
    await tx.eventKennel.deleteMany({ where: { eventId: ghost.id } });
    await tx.event.delete({ where: { id: ghost.id } });
  });

  console.log("✓ Healed survivor hares and deleted the /events/ ghost.");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
