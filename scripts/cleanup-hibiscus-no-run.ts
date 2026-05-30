/**
 * One-shot cleanup for the Hibiscus H3 "King's Birthday — no run" phantom
 * event (#1786).
 *
 * Background:
 *   Hibiscus H3's hareline Google Sheet carries holiday rows that have a real
 *   date but a "no run" note in the Where column (e.g.
 *   "Kings B'day, no run , Yours"). The GOOGLE_SHEETS adapter ingested this as
 *   a real run with a map + weather. PR for #1739 adds a `silentlySkipPatterns`
 *   rule (`\bno\s+run\b` on the location field) so such rows can never
 *   re-ingest; this script removes the already-persisted phantom Event + its
 *   RawEvent(s) (there are two — a re-scrape produced a duplicate raw).
 *
 * Safety / idempotency:
 *   - Verifies the target Event's location still contains "no run" before
 *     deleting (refuses if the row drifted).
 *   - Deletes the phantom RawEvent(s) outright (not unlink) so they cannot
 *     re-merge into a fresh phantom.
 *   - No-op on re-run (Event already gone → reports clean, exit 0).
 *   - Dry run by default; set CLEANUP_APPLY=1 to mutate.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-hibiscus-no-run.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-hibiscus-no-run.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_ID = "cmp9wo2nx001q04lam9go48hk";
const SOURCE_NAME = "Hibiscus H3 Hareline Sheet";
const NO_RUN_RE = /\bno\s+run\b/i;

const APPLY = process.env.CLEANUP_APPLY === "1";

/** True when a RawEvent.rawData is a "no run" holiday phantom (location note). */
function isPhantomRaw(rawData: unknown): boolean {
  if (!rawData || typeof rawData !== "object") return false;
  const location = (rawData as { location?: unknown }).location;
  return typeof location === "string" && NO_RUN_RE.test(location);
}

async function main(): Promise<void> {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`[cleanup-hibiscus] ${mode} — target Event ${EVENT_ID} ("no run" holiday row)`);

  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME }, select: { id: true } });
  if (!source) throw new Error(`Source not found: ${SOURCE_NAME}`);

  const event = await prisma.event.findUnique({
    where: { id: EVENT_ID },
    select: { id: true, locationName: true, status: true },
  });

  // Delete ONLY the RawEvents linked to the target Event. Scan the source for
  // signature-matching rows that are NOT linked to this event and FAIL CLOSED
  // if any exist (Codex adversarial review): a "no run" note could legitimately
  // recur on a past/future Hibiscus row, and deleting by signature alone would
  // erase unrelated source/audit data. Surface strays for a human instead.
  const sourceRaws = await prisma.rawEvent.findMany({
    where: { sourceId: source.id },
    select: { id: true, eventId: true, rawData: true },
  });
  const phantomRawIds = sourceRaws.filter((r) => r.eventId === EVENT_ID).map((r) => r.id);
  const strayMatches = sourceRaws
    .filter((r) => r.eventId !== EVENT_ID && isPhantomRaw(r.rawData))
    .map((r) => r.id);
  if (strayMatches.length > 0) {
    throw new Error(
      `Found ${strayMatches.length} "no run" RawEvent(s) NOT linked to ${EVENT_ID}: ` +
        `[${strayMatches.join(", ")}]. Refusing to delete unrelated source data — investigate manually.`,
    );
  }

  if (!event && phantomRawIds.length === 0) {
    console.log("[cleanup-hibiscus] Nothing to do — phantom Event and RawEvents already removed.");
    return;
  }

  if (event && !(event.locationName && NO_RUN_RE.test(event.locationName))) {
    throw new Error(
      `Refusing to delete: Event ${EVENT_ID} locationName is "${event.locationName}", ` +
        `expected it to contain "no run". The row may have drifted — investigate manually.`,
    );
  }

  console.log(
    `[cleanup-hibiscus] Would delete: Event=${event ? `${event.id} (status ${event.status})` : "none"}, ` +
      `RawEvents=${phantomRawIds.length} [${phantomRawIds.join(", ")}]`,
  );

  if (!APPLY) {
    console.log("[cleanup-hibiscus] DRY-RUN complete. Re-run with CLEANUP_APPLY=1 to delete.");
    return;
  }

  await prisma.$transaction([
    prisma.eventHare.deleteMany({ where: { eventId: EVENT_ID } }),
    prisma.attendance.deleteMany({ where: { eventId: EVENT_ID } }),
    prisma.kennelAttendance.deleteMany({ where: { eventId: EVENT_ID } }),
    prisma.event.updateMany({ where: { parentEventId: EVENT_ID }, data: { parentEventId: null } }),
    prisma.rawEvent.deleteMany({ where: { id: { in: phantomRawIds } } }),
    prisma.event.deleteMany({ where: { id: EVENT_ID } }),
  ]);

  const eventStill = await prisma.event.findUnique({ where: { id: EVENT_ID }, select: { id: true } });
  const rawsStill = await prisma.rawEvent.count({ where: { id: { in: phantomRawIds } } });
  if (eventStill || rawsStill > 0) {
    throw new Error(`Post-delete check failed: event=${!!eventStill}, rawsRemaining=${rawsStill}`);
  }

  console.log(
    "[cleanup-hibiscus] " +
      JSON.stringify({
        action: "delete_phantom_event",
        issue: 1786,
        eventId: EVENT_ID,
        rawEventsDeleted: phantomRawIds.length,
        timestamp: new Date().toISOString(),
      }),
  );
  console.log("[cleanup-hibiscus] Done.");
}

main()
  .catch((err) => {
    console.error("[cleanup-hibiscus] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
