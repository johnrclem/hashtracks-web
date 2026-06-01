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

  // Survivor: the timed /runs/ event with the real run number 2001. Require
  // exactly one — a destructive cleanup must abort on any ambiguity.
  const survivorCandidates = events.filter(
    (e) => e.runNumber === 2001 && endpointsOf(e).some((u) => RUNS_RE.test(u)),
  );
  if (survivorCandidates.length !== 1) {
    console.error(`✗ Expected exactly one /runs/ survivor (runNumber 2001), found ${survivorCandidates.length}. Aborting.`);
    process.exitCode = 1;
    return;
  }
  const survivor = survivorCandidates[0];

  // Ghost: an /events/-only event with no run number (the all-day duplicate).
  // Require at least one endpoint so an empty-rawEvents row can't pass the
  // `.every()` vacuously, and abort if more than one matches.
  const ghostCandidates = events.filter((e) => {
    if (e.id === survivor.id || e.runNumber != null) return false;
    const endpoints = endpointsOf(e);
    return endpoints.length > 0 && endpoints.every((u) => EVENTS_RE.test(u));
  });
  if (ghostCandidates.length > 1) {
    console.error(`✗ Expected at most one /events/ ghost, found ${ghostCandidates.length}. Aborting.`);
    process.exitCode = 1;
    return;
  }
  const ghost = ghostCandidates[0];

  if (!ghost) {
    console.log("✓ No /events/ ghost found — already coalesced. Nothing to do.");
    return;
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

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
