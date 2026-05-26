/**
 * One-shot cleanup for the 2027-06-26 NYC 5-Boro orphan Event (PR E.7).
 *
 * Pre-PR-#1678, a Hash Rego scrape misfired the year-rollover heuristic
 * on the 5-Boro Pub Crawl 2026 and emitted a Day-3 RawEvent dated
 * `2027-06-26` (Friday 6/26 was wrongly bumped to next year because the
 * Hash Rego index startDate was Saturday 6/27, not Friday). The
 * fingerprint hashed in that mistake, so post-#1678 scrapes don't
 * overwrite it — they create new RawEvents at the correct 2026 dates,
 * leaving the 2027-06-26 row + its backing RawEvent as a fossil that
 * pollutes `?q=5-boro` search results.
 *
 * The existing `scripts/cleanup-orphan-events-after-series.ts` filters
 * on `rawEvents: { none: {} }` and won't catch this row (it still has
 * its stale RawEvent backing it). This script targets the single known
 * orphan by ID, with safety guards so re-running can't delete the
 * wrong row:
 *   - Event ID must match `cmplbbe9k000604ic44er23kw`
 *   - Event date must be ≥ 2027-01-01
 *   - Event title must include `5-boro` (case-insensitive)
 *
 * All three guards must pass before deletion. Re-running on a clean DB
 * is a no-op (exit 0, logs "already cleaned").
 *
 * Usage:
 *   Dry run:  npx tsx scripts/cleanup-5-boro-2027-orphan.ts
 *   Apply:    APPLY=1 npx tsx scripts/cleanup-5-boro-2027-orphan.ts
 *
 * Reference: #1560 follow-up (PR E.7); validation report on PR #1678.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const TARGET_EVENT_ID = "cmplbbe9k000604ic44er23kw";
const TARGET_DATE_MIN = new Date("2027-01-01T00:00:00Z");
const TARGET_TITLE_FRAGMENT = "5-boro";

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(`[cleanup-5-boro-2027-orphan] mode=${apply ? "APPLY" : "DRY RUN"}`);

  const event = await prisma.event.findUnique({
    where: { id: TARGET_EVENT_ID },
    select: {
      id: true,
      date: true,
      title: true,
      parentEventId: true,
      isSeriesParent: true,
      _count: { select: { rawEvents: true } },
    },
  });

  if (!event) {
    console.log(`[cleanup] target ${TARGET_EVENT_ID} not found — already cleaned. Exiting 0.`);
    return;
  }

  // Safety guards — all must pass before we'll touch the row.
  // Throw rather than `process.exit` so the `.finally(prisma.$disconnect)`
  // below still runs and releases the DB connection cleanly (Gemini review).
  if (event.date < TARGET_DATE_MIN) {
    throw new Error(
      `REFUSING: target Event date=${event.date.toISOString()} is BEFORE 2027-01-01. ` +
        `The orphan we're chasing is at 2027-06-26; this row doesn't match.`,
    );
  }
  if (!event.title?.toLowerCase().includes(TARGET_TITLE_FRAGMENT)) {
    throw new Error(
      `REFUSING: target Event title=${JSON.stringify(event.title)} doesn't contain ` +
        `"${TARGET_TITLE_FRAGMENT}".`,
    );
  }
  // Defensive: never delete a series parent or a child of an active series.
  // The known orphan satisfies parentEventId=null AND isSeriesParent=false.
  if (event.isSeriesParent || event.parentEventId) {
    throw new Error(
      `REFUSING: target Event is part of an active series (parentEventId=` +
        `${event.parentEventId} isSeriesParent=${event.isSeriesParent}).`,
    );
  }

  console.log(`[cleanup] target found:`);
  console.log(`  id:       ${event.id}`);
  console.log(`  date:     ${event.date.toISOString()}`);
  console.log(`  title:    ${event.title}`);
  console.log(`  rawEvents: ${event._count.rawEvents}`);

  if (!apply) {
    console.log(`[cleanup] DRY RUN — would delete the Event and its ${event._count.rawEvents} backing RawEvent(s).`);
    console.log(`[cleanup] Re-run with APPLY=1 to actually delete.`);
    return;
  }

  // Delete in a transaction: RawEvents first, then the Event row.
  // `RawEvent.event` is an optional relation in prisma/schema.prisma WITHOUT
  // an explicit `onDelete: Cascade`, so the default behavior is SetNull on
  // the FK — deleting the Event would orphan the RawEvent at
  // `eventId: null` instead of removing it. Explicit RawEvent.deleteMany
  // is necessary here (Gemini PR #1697 review — verified against schema).
  const result = await prisma.$transaction(async (tx) => {
    const rawDel = await tx.rawEvent.deleteMany({ where: { eventId: event.id } });
    const eventDel = await tx.event.delete({ where: { id: event.id } });
    return { rawDeleted: rawDel.count, eventDeleted: eventDel.id };
  });

  console.log(`[cleanup] DONE — deleted ${result.rawDeleted} RawEvent(s) + Event ${result.eventDeleted}.`);
}

main()
  .catch((err) => {
    console.error("[cleanup] fatal:", err);
    // Set exitCode rather than calling process.exit(1) — the latter
    // terminates Node synchronously and prevents the `.finally` cleanup
    // (prisma.$disconnect) from running. Node will exit with code 1 once
    // the event loop drains (CodeRabbit PR #1697 review).
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
