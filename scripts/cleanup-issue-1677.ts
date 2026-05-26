/**
 * One-shot cleanup for issue #1677 — Moooouston H3 title leak.
 *
 * A single 2026-04-27 event was titled `**update**` because the Houston
 * Hash umbrella GCal had a bare-SUMMARY VEVENT and the adapter promoted
 * the description's first non-label line ("**update**") as the title.
 *
 * The `preferDefaultTitleOverDescription` flag added in this PR (set on
 * the Houston Hash Calendar source) prevents future leaks of the same
 * shape, but the existing Event row persists until cleaned up here. A
 * fresh scrape after this delete will recreate the event with the
 * correct `defaultTitles["moooouston-h3"]` title ("Moooouston H3 Trail").
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_TO_DELETE = "cmn3qazho00l004l2jtkheqjn";

async function main() {
  const existing = await prisma.event.findUnique({
    where: { id: EVENT_TO_DELETE },
    select: {
      id: true,
      title: true,
      date: true,
      kennelId: true,
      _count: { select: { hares: true, attendances: true, kennelAttendances: true } },
    },
  });
  if (!existing) {
    console.log(`Event ${EVENT_TO_DELETE} already gone — nothing to do.`);
    return;
  }
  console.log(`Found: ${existing.title} on ${existing.date.toISOString()} (kennel ${existing.kennelId})`);
  console.log(
    `  related rows: ${existing._count.hares} EventHare, ${existing._count.attendances} Attendance, ${existing._count.kennelAttendances} KennelAttendance`,
  );

  // EventHare, Attendance, and KennelAttendance have no onDelete cascade
  // (verified against prisma/schema.prisma). Delete them explicitly inside
  // the transaction so the final `event.delete()` doesn't FK-fail.
  await prisma.$transaction(async (tx) => {
    const hareDeleted = await tx.eventHare.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    const attDeleted = await tx.attendance.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    const kaDeleted = await tx.kennelAttendance.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    const rawDeleted = await tx.rawEvent.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    const ekDeleted = await tx.eventKennel.deleteMany({ where: { eventId: EVENT_TO_DELETE } });
    await tx.event.delete({ where: { id: EVENT_TO_DELETE } });
    console.log(
      `Deleted ${hareDeleted.count} EventHare(s), ${attDeleted.count} Attendance(s), ${kaDeleted.count} KennelAttendance(s), ${rawDeleted.count} RawEvent(s), ${ekDeleted.count} EventKennel(s), and the Event itself.`,
    );
  });
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
