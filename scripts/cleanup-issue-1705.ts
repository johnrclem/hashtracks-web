/**
 * One-shot cleanup for issue #1705 — Mosquito H3 title leak.
 *
 * A single 2025-08-06 event was titled "Broke back ranger is laying a 3
 * mil3 a to a." because the Houston Hash umbrella GCal had a bare-SUMMARY
 * VEVENT and the adapter promoted the description's first non-label line
 * (a freeform trail-prose sentence) as the title.
 *
 * The `preferDefaultTitleOverDescription` flag plus the new
 * `defaultTitles["mosquito-h3"]` entry added in this PR (both on the
 * Houston Hash Calendar source) prevent future leaks of the same shape.
 * A fresh scrape after this delete will recreate the event with the
 * correct title ("Mosquito H3 Trail").
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_TO_DELETE = "cmn3qacn9007604l2pnlvms0u";

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
