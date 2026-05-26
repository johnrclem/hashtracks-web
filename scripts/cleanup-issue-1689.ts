/**
 * One-shot cleanup for issue #1689 — Narwhal H3 Meetup admin notice.
 *
 * Narwhal H3 fully migrated off Meetup to cthashing.com on 2026-03-10. They
 * posted a farewell event ("Moving to a new website site - Last day in
 * Meetup is March 10th") and then deleted the entire Meetup group. The
 * adapter ingested the farewell as a hash event before the group was
 * removed; the source row is `enabled: false` in this PR and the Meetup
 * adapter now drops ADMIN_NOTICE_PATTERNS at ingest, so the leak can't
 * recur. This script removes the existing surfaced row.
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_TO_DELETE = "cmmobywa3000304i8sxiz8i44";

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
