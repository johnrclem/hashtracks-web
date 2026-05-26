/**
 * One-shot cleanup for issue #1690 — Houston H3 PII (medical appointment).
 *
 * A personal medical appointment ("Sleep Study - Christine Kuhl Remote visit")
 * was accidentally added to the shared Houston H3 Google Calendar by a
 * contributor. The adapter ingested it as a hash event and it surfaced on
 * the public hareline.
 *
 * The PERSONAL_TITLE_PATTERNS hardening in this PR prevents future leaks of
 * the same shape (medical / telehealth / sleep study), but the existing row
 * persists until cleaned up here. We also encourage the kennel admin to
 * remove the appointment from the upstream Google Calendar — until they do,
 * even with the parser fix we won't re-ingest the row, so this is a
 * one-shot delete.
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_TO_DELETE = "cmphcgutv001g04jljb96mv3g";

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
  // the transaction so the final `event.delete()` doesn't FK-fail. Order
  // matters: deepest references first.
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
