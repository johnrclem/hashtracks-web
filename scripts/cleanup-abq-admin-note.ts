/**
 * One-shot cleanup for the ABQ H3 "LYNNE OFF" phantom event (#1783).
 *
 * Background:
 *   ABQ H3's Google Calendar source opts into `includeAllDayEvents` (their
 *   Tuesday CLiT runs are entered as all-day blocks). That also admitted the
 *   kennel admin's personal all-day OOO block "LYNNE OFF", which surfaced on
 *   /hareline as a phantom Friday run. PR for #1739 adds a
 *   `silentlySkipPatterns` rule to the source so the row can never re-ingest;
 *   this script removes the already-persisted phantom Event + its RawEvent(s).
 *
 * Safety / idempotency:
 *   - Verifies the target Event still matches "LYNNE OFF" before deleting
 *     (refuses if the row drifted to something else).
 *   - Deletes the phantom RawEvent(s) outright (not unlink) so they cannot
 *     re-merge into a fresh phantom; canonical RawEvents are an audit trail but
 *     a personal OOO note is not legitimate scraped data.
 *   - No-op on re-run (Event already gone → reports clean, exit 0).
 *   - Dry run by default; set CLEANUP_APPLY=1 to mutate.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-abq-admin-note.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-abq-admin-note.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const EVENT_ID = "cmpqmy3m9000b04joivvx6nt1";
const SOURCE_NAME = "ABQ H3 Google Calendar";
const EXPECTED_TITLE = "LYNNE OFF";

const APPLY = process.env.CLEANUP_APPLY === "1";

/** True when a RawEvent.rawData is the "LYNNE OFF" phantom. */
function isPhantomRaw(rawData: unknown): boolean {
  if (!rawData || typeof rawData !== "object") return false;
  const title = (rawData as { title?: unknown }).title;
  return typeof title === "string" && title.trim().toUpperCase() === EXPECTED_TITLE;
}

async function main(): Promise<void> {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`[cleanup-abq] ${mode} — target Event ${EVENT_ID} ("${EXPECTED_TITLE}")`);

  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME }, select: { id: true } });
  if (!source) throw new Error(`Source not found: ${SOURCE_NAME}`);

  const event = await prisma.event.findUnique({
    where: { id: EVENT_ID },
    select: { id: true, title: true, status: true },
  });

  // Delete ONLY the RawEvents linked to the target Event. We additionally scan
  // the source for signature-matching rows that are NOT linked to this event
  // and FAIL CLOSED if any exist (Codex adversarial review): deleting by
  // signature alone could erase unrelated source/audit data. A stray match
  // means something unexpected — surface it for a human rather than over-delete.
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
      `Found ${strayMatches.length} "${EXPECTED_TITLE}" RawEvent(s) NOT linked to ${EVENT_ID}: ` +
        `[${strayMatches.join(", ")}]. Refusing to delete unrelated source data — investigate manually.`,
    );
  }

  if (!event && phantomRawIds.length === 0) {
    console.log("[cleanup-abq] Nothing to do — phantom Event and RawEvents already removed.");
    return;
  }

  if (event && event.title?.trim().toUpperCase() !== EXPECTED_TITLE) {
    throw new Error(
      `Refusing to delete: Event ${EVENT_ID} title is "${event.title}", expected "${EXPECTED_TITLE}". ` +
        `The row may have drifted — investigate manually.`,
    );
  }

  console.log(
    `[cleanup-abq] Would delete: Event=${event ? `${event.id} (status ${event.status})` : "none"}, ` +
      `RawEvents=${phantomRawIds.length} [${phantomRawIds.join(", ")}]`,
  );

  if (!APPLY) {
    console.log("[cleanup-abq] DRY-RUN complete. Re-run with CLEANUP_APPLY=1 to delete.");
    return;
  }

  await prisma.$transaction([
    // Dependent records keyed on the Event (no onDelete cascade in schema).
    prisma.eventHare.deleteMany({ where: { eventId: EVENT_ID } }),
    prisma.attendance.deleteMany({ where: { eventId: EVENT_ID } }),
    prisma.kennelAttendance.deleteMany({ where: { eventId: EVENT_ID } }),
    // Defensive: orphan any child events that pointed at this one.
    prisma.event.updateMany({ where: { parentEventId: EVENT_ID }, data: { parentEventId: null } }),
    // Delete the phantom RawEvents (audit pollution — not legitimate data).
    prisma.rawEvent.deleteMany({ where: { id: { in: phantomRawIds } } }),
    // Delete the canonical Event (EventKennel + EventLink cascade in schema).
    prisma.event.deleteMany({ where: { id: EVENT_ID } }),
  ]);

  // Post-delete orphan check.
  const eventStill = await prisma.event.findUnique({ where: { id: EVENT_ID }, select: { id: true } });
  const rawsStill = await prisma.rawEvent.count({ where: { id: { in: phantomRawIds } } });
  if (eventStill || rawsStill > 0) {
    throw new Error(`Post-delete check failed: event=${!!eventStill}, rawsRemaining=${rawsStill}`);
  }

  console.log(
    "[cleanup-abq] " +
      JSON.stringify({
        action: "delete_phantom_event",
        issue: 1783,
        eventId: EVENT_ID,
        rawEventsDeleted: phantomRawIds.length,
        timestamp: new Date().toISOString(),
      }),
  );
  console.log("[cleanup-abq] Done.");
}

main()
  .catch((err) => {
    console.error("[cleanup-abq] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
