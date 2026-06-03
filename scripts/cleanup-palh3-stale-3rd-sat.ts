/**
 * One-shot cleanup for the stale PalH3 "PalH3 Monthly Run" placeholder Events
 * left behind when the STATIC_SCHEDULE recurrence was corrected from a single
 * "3rd Saturday monthly" rule to "2nd & 4th Saturday" (#1903).
 *
 * Background:
 *   The old STATIC source synthesized one event per month on the 3rd Saturday
 *   with the generic title "PalH3 Monthly Run". The corrected schedule emits
 *   events on the 2nd & 4th Saturdays with the new default title "Palmetto H3
 *   Trail", so every old 3rd-Saturday placeholder is orphaned at a date the
 *   adapter no longer produces. The reconciler would cancel them (cancelled-but-
 *   visible); this deletes them outright.
 *
 *   This is the canonical-ghost cleanup that accompanies a date-changing static
 *   schedule fix (memory: feedback_parser_fix_canonical_ghosts). Modeled on
 *   cleanup-dcfmh3-placeholder-events.ts.
 *
 * Selection (intentionally narrow):
 *   Events for the `palh3` kennel whose title is EXACTLY the old placeholder
 *   "PalH3 Monthly Run". The corrected STATIC adapter emits "Palmetto H3 Trail"
 *   and the "Sumter Hasher Trail Info" Google Calendar emits real per-run
 *   titles, so live events are never matched. Events with attendance check-ins
 *   are SKIPPED (synthetic placeholders shouldn't have any; flag loudly if so).
 *
 * Run order (POST-merge — Vercel deploys schema but not seed data):
 *   1. npx prisma db seed                                  # flips the RRULE to 2SA/4SA
 *   2. re-scrape PalH3 (admin re-scrape / cron)            # creates the 2nd/4th-Sat events
 *   3. npx tsx scripts/cleanup-palh3-stale-3rd-sat.ts            # dry run
 *   4. CLEANUP_APPLY=1 npx tsx scripts/cleanup-palh3-stale-3rd-sat.ts  # apply
 */

import "dotenv/config";
import { prisma } from "@/lib/db";

const KENNEL_CODE = "palh3";
export const PLACEHOLDER_TITLE = "PalH3 Monthly Run";
const APPLY = process.env.CLEANUP_APPLY === "1";

async function main() {
  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true },
  });
  if (!kennel) throw new Error(`Kennel ${KENNEL_CODE} not found`);

  const placeholders = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: PLACEHOLDER_TITLE },
    select: {
      id: true,
      date: true,
      status: true,
      _count: { select: { attendances: true } },
    },
    orderBy: { date: "asc" },
  });

  console.log(`Found ${placeholders.length} "${PLACEHOLDER_TITLE}" events for ${KENNEL_CODE}.`);
  if (placeholders.length === 0) return;

  const withAttendance = placeholders.filter((e) => e._count.attendances > 0);
  const deletable = placeholders.filter((e) => e._count.attendances === 0);

  for (const e of placeholders) {
    console.log(
      `  ${e.date.toISOString().slice(0, 10)}  status=${e.status}  attendances=${e._count.attendances}` +
        (e._count.attendances > 0 ? "  → SKIP (has check-ins)" : ""),
    );
  }
  if (withAttendance.length > 0) {
    console.warn(
      `\n⚠️  ${withAttendance.length} placeholder event(s) have attendance check-ins and will NOT be deleted. ` +
        `Investigate before forcing — a real check-in on a synthetic placeholder is unexpected.`,
    );
  }

  if (!APPLY) {
    console.log(`\nDry run. Would delete ${deletable.length} event(s) (+ their RawEvents/EventKennel rows).`);
    console.log("Re-run with CLEANUP_APPLY=1 to apply.");
    return;
  }

  const ids = deletable.map((e) => e.id);
  const result = await prisma.$transaction(async (tx) => {
    // Delete the non-cascading Event children first (only EventKennel + EventLink
    // have onDelete: Cascade). Mirrors the authoritative admin bulk-delete order
    // in src/app/admin/events/actions.ts. Attendance is already excluded above
    // (deletable = 0 check-ins); EventHare/KennelAttendance shouldn't exist on a
    // synthetic STATIC placeholder, but clear them so the Event delete can't trip
    // a P2003 FK violation. RawEvents are dropped so a future merge can't
    // re-materialize the placeholder.
    await tx.eventHare.deleteMany({ where: { eventId: { in: ids } } });
    await tx.kennelAttendance.deleteMany({ where: { eventId: { in: ids } } });
    const raws = await tx.rawEvent.deleteMany({ where: { eventId: { in: ids } } });
    const events = await tx.event.deleteMany({ where: { id: { in: ids } } });
    return { raws: raws.count, events: events.count };
  });

  console.log(`\n✅ Deleted ${result.events} placeholder events and ${result.raws} orphaned RawEvents.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
