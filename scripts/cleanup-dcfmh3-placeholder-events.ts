/**
 * One-shot cleanup for the stale DCFMH3 "DCFMH3 Full Moon Run" placeholder
 * Events left behind when the source moved from STATIC_SCHEDULE (lunar anchor)
 * to the Google Sites HTML scraper (#1399 / #1400).
 *
 * Background:
 *   The old lunar source synthesized one event per month with the generic title
 *   "DCFMH3 Full Moon Run" on a *drifted* date (the Saturday nearest the full
 *   moon, 1–3 days off the published schedule). The new DCFMH3Adapter parses the
 *   published Google Sites calendar, so it emits events with real moon/host
 *   titles on the *correct* dates. Because the dates differ, the new events are
 *   NEW canonical rows — the old placeholders are orphaned at the wrong dates and
 *   would otherwise linger (cancelled-but-visible) on the kennel page.
 *
 *   This is the canonical-ghost cleanup that always accompanies a
 *   fingerprint/date-changing parser swap (memory:
 *   feedback_parser_fix_canonical_ghosts). Phuket (#1410/#1411) and Hump D
 *   (#1348-#1350) need NO equivalent script — their dates are unchanged, so
 *   merge's equal-trust update branch refreshes title/endTime/cost/dogFriendly
 *   in place on the next scrape.
 *
 * Selection (intentionally narrow):
 *   Events for the `dcfmh3` kennel whose title is EXACTLY the old placeholder
 *   "DCFMH3 Full Moon Run". The new scraper never emits that string, so live
 *   events are never matched. Events that have attendance check-ins are SKIPPED
 *   (these synthetic placeholders shouldn't have any; bail loudly if they do).
 *
 * Run order (POST-merge — Vercel deploys schema but not seed data):
 *   1. npx prisma db seed                       # flips the source to HTML_SCRAPER
 *   2. re-scrape DCFMH3 (admin re-scrape / cron) # creates the real events
 *   3. npx tsx scripts/cleanup-dcfmh3-placeholder-events.ts            # dry run
 *   4. CLEANUP_APPLY=1 npx tsx scripts/cleanup-dcfmh3-placeholder-events.ts  # apply
 */

import "dotenv/config";
import { prisma } from "@/lib/db";

const KENNEL_CODE = "dcfmh3";
export const PLACEHOLDER_TITLE = "DCFMH3 Full Moon Run";
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
    // Old lunar-synthesized RawEvents are dead once the source is HTML-scraped;
    // delete them so a future merge can't re-materialize the placeholder, and so
    // the Event delete doesn't trip the RawEvent.eventId FK.
    const raws = await tx.rawEvent.deleteMany({ where: { eventId: { in: ids } } });
    // EventKennel + EventLink cascade on Event delete (schema onDelete: Cascade).
    const events = await tx.event.deleteMany({ where: { id: { in: ids } } });
    return { raws: raws.count, events: events.count };
  });

  console.log(`\n✅ Deleted ${result.events} placeholder events and ${result.raws} orphaned RawEvents.`);
}

main()
  .catch((err) => {
    console.error(err);
    // Set exitCode (don't process.exit) so the .finally() disconnect still runs.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
