/**
 * One-shot cleanup for issue #1421 — SF H3 cross-source duplicate.
 *
 * Removes the orphaned canonical Event ("Bay 2 Blackout 2026",
 * cmn97ic7a003q04jrf1usz8vp) and its single dangling RawEvent. The umbrella
 * VEVENT that created this record is no longer emitted by SFH3 for 2026-05-15
 * (LAST-MODIFIED moved it to 2026-05-14) AND the adapter fix in this PR
 * suppresses same-day umbrella/trail collisions going forward.
 *
 * The canonical Event 1 ("Friday Turkey / Eagle Run & Pub Crawl",
 * cmmtcnvq9007n04jpxqo3rq6j) already carries both source URLs (events/134 as
 * Event.sourceUrl + runs/6485 as an EventLink) so no link migration is needed.
 *
 * Safe to re-run: no-ops if Event 2 has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_TO_DELETE = "cmn97ic7a003q04jrf1usz8vp";

async function main() {
  const existing = await prisma.event.findUnique({
    where: { id: EVENT_TO_DELETE },
    select: { id: true, title: true, date: true },
  });
  if (!existing) {
    console.log(`Event ${EVENT_TO_DELETE} already gone — nothing to do.`);
    return;
  }
  console.log(`Found: ${existing.title} on ${existing.date.toISOString()}`);

  // EventLink rows for this event are deleted automatically by Postgres
  // (EventLink.event has onDelete: Cascade in prisma/schema.prisma) — no
  // explicit delete needed. Event 2 had zero EventLinks anyway.
  await prisma.$transaction(async (tx) => {
    const rawDeleted = await tx.rawEvent.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    const ekDeleted = await tx.eventKennel.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    await tx.event.delete({ where: { id: EVENT_TO_DELETE } });
    console.log(`Deleted ${rawDeleted.count} RawEvent(s), ${ekDeleted.count} EventKennel(s), and the Event itself.`);
  });
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
