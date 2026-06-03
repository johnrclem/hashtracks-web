/**
 * One-shot cleanup for the stale "Future VTH3 Run" placeholder Events left
 * behind by the now-disabled Von Tramp H3 Meetup source (#1144 / #1459).
 *
 * Background:
 *   Von Tramp migrated off Meetup — https://www.meetup.com/vontramph3/ returns
 *   "Group not found". Before it died the group published real trails (the
 *   "VTH3 Trail #NNN: …" events, which we keep), but its final state was a
 *   single recurring placeholder slot titled "Future VTH3 Run — First and Third
 *   Saturdays of the Month" (a/k/a "Future VTH3 Run"). The Meetup source is now
 *   `enabled: false` in seed, so it will never be re-scraped — which means the
 *   reconciler (only runs while scraping enabled sources) will never cancel
 *   these placeholders. They would otherwise linger, future-dated, on the
 *   public kennel page for months until their dates pass.
 *
 *   This is the canonical-ghost cleanup that accompanies retiring a source
 *   (memory: feedback_parser_fix_canonical_ghosts). The kennel stays visible;
 *   its real history (#079–#089 etc.) is untouched and the FB Hosted Events
 *   source remains for future events (its checkpoint/IP limitation is tracked
 *   in a separate follow-up).
 *
 * Selection (intentionally narrow):
 *   Events for the `vth3` kennel whose title starts with "Future VTH3 Run"
 *   AND whose RawEvents all trace to the retired Meetup source. Real trails are
 *   titled "VTH3 Trail #NNN: …", so live events are never matched. Events with
 *   human check-ins (user RSVP or misman) are SKIPPED. The actual delete goes
 *   through the shared race-safe deleteLeakedEvent helper (FOR UPDATE lock +
 *   delete-time required-empty checks), so a check-in that races in after the
 *   snapshot rolls that event's delete back instead of destroying it.
 *
 * Run order (POST-merge — Vercel deploys schema/migration but not seed data):
 *   1. npx prisma db seed                                       # disables the Meetup source
 *   2. npx tsx scripts/cleanup-vth3-meetup-placeholders.ts      # dry run
 *   3. CLEANUP_APPLY=1 npx tsx scripts/cleanup-vth3-meetup-placeholders.ts  # apply
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import {
  deleteLeakedEvent,
  DeleteSafetyViolationError,
  ForeignRawSourceError,
} from "./lib/delete-leaked-event";

const KENNEL_CODE = "vth3";
export const PLACEHOLDER_TITLE_PREFIX = "Future VTH3 Run";
// Provenance guard: only events provably produced by THIS retired source are
// deletable. The title prefix alone is not enough — a future FB/website import
// or an admin edit could in theory reuse it, and this is a delete path.
const MEETUP_SOURCE_NAME = "Von Tramp H3 Meetup";
const APPLY = process.env.CLEANUP_APPLY === "1";

async function main() {
  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true },
  });
  if (!kennel) throw new Error(`Kennel ${KENNEL_CODE} not found`);

  const meetupSource = await prisma.source.findFirst({
    where: { name: MEETUP_SOURCE_NAME, type: "MEETUP" },
    select: { id: true },
  });
  if (!meetupSource) throw new Error(`Source "${MEETUP_SOURCE_NAME}" (MEETUP) not found`);

  const placeholders = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { startsWith: PLACEHOLDER_TITLE_PREFIX } },
    select: {
      id: true,
      date: true,
      title: true,
      status: true,
      // Both human check-in tables (user RSVPs + misman records) are non-cascading
      // and must never be auto-deleted; count both as a skip guard.
      _count: { select: { attendances: true, kennelAttendances: true, hares: true } },
      rawEvents: { select: { sourceId: true, source: { select: { name: true } } } },
    },
    orderBy: { date: "asc" },
  });

  console.log(
    `Found ${placeholders.length} "${PLACEHOLDER_TITLE_PREFIX}…" events for ${KENNEL_CODE}.`,
  );
  if (placeholders.length === 0) return;

  // An event is deletable only if it has zero human-attributable rows — check-ins
  // (user OR misman) AND hare credits (EventHare can carry a userId / MISMAN_SYNC
  // attribution, so it's not always disposable scraper metadata) — AND every one
  // of its RawEvents traces to the retired Meetup source (≥1 Meetup raw, no
  // foreign raw, no zero-raw orphan). Anything else is reported and skipped.
  const deletable: typeof placeholders = [];
  for (const e of placeholders) {
    const sources = [
      ...new Set(e.rawEvents.map((r) => r.source?.name ?? "(no source)")),
    ].join(", ");
    const hasMeetupRaw = e.rawEvents.some((r) => r.sourceId === meetupSource.id);
    const hasForeignRaw = e.rawEvents.some((r) => r.sourceId !== meetupSource.id);
    const meetupOnly = hasMeetupRaw && !hasForeignRaw;
    const checkIns = e._count.attendances + e._count.kennelAttendances;
    const skipReason =
      checkIns > 0
        ? "SKIP (has check-ins)"
        : e._count.hares > 0
          ? "SKIP (has hare credits)"
          : !meetupOnly
            ? "SKIP (not Meetup-only provenance)"
            : null;
    if (!skipReason) deletable.push(e);
    console.log(
      `  ${e.date.toISOString().slice(0, 10)}  status=${e.status}  ` +
        `checkIns=${checkIns}  hares=${e._count.hares}  sources=[${sources}]` +
        (skipReason ? `  → ${skipReason}` : ""),
    );
  }

  const skipped = placeholders.length - deletable.length;
  if (skipped > 0) {
    console.warn(
      `\n⚠️  ${skipped} matched event(s) skipped (check-ins, hare credits, or non-Meetup provenance). ` +
        `Any of those on a "${PLACEHOLDER_TITLE_PREFIX}" event is unexpected — investigate before forcing.`,
    );
  }

  if (!APPLY) {
    console.log(
      `\nDry run. Would delete ${deletable.length} event(s) (+ their RawEvents/EventKennel rows).`,
    );
    console.log("Re-run with CLEANUP_APPLY=1 to apply.");
    return;
  }

  // Hard-delete via the shared race-safe helper. Under a FOR UPDATE lock it
  // re-checks, AT DELETE TIME, that (a) no hare credit or human check-in raced
  // in (user RSVP or misman) and (b) no foreign-source RawEvent has merged onto
  // the event since our snapshot (forbidForeignRawSourceId = the Meetup source).
  // Any violation rolls that event's delete back and is reported, not destroyed.
  // Hard-deleting the RawEvents (vs unlinking) keeps the placeholder from ever
  // re-materializing.
  let deleted = 0;
  for (const e of deletable) {
    try {
      await deleteLeakedEvent(
        prisma,
        e.id,
        ["hares", "attendances", "kennelAttendances"],
        meetupSource.id,
      );
      deleted++;
    } catch (err) {
      if (err instanceof DeleteSafetyViolationError || err instanceof ForeignRawSourceError) {
        console.warn(`  ⚠️  Skipped ${e.id} (${e.date.toISOString().slice(0, 10)}): ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  console.log(`\n✅ Deleted ${deleted} of ${deletable.length} placeholder event(s).`);

  // The deleted placeholders are future-dated and may have been VTH3's cached
  // MAX(date); recompute lastEventDate via the canonical backfill (matches the
  // nightly audit predicate exactly — see reference_lasteventdate_recompute_symmetry)
  // so VTH3's activity sort/badge can't keep ranking off deleted rows.
  const refreshed = await backfillLastEventDates();
  console.log(`Recomputed lastEventDate (${refreshed} kennel row(s) updated).`);
}

main()
  .catch((err) => {
    console.error(err);
    // Set exitCode (don't process.exit) so the .finally() disconnect still runs.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
