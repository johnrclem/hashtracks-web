/**
 * One-shot cleanup for the single AH4 Event the FIRST apply of
 * `scripts/backfill-ah4-wayback-history.ts` created with an INFERRED date.
 *
 * Background:
 *   The first apply (14 rows) trusted `extractEventDate`, which falls back to
 *   "next Saturday after the post timestamp" (`inferDateFromHashDay`) when a
 *   post carries no explicit date. For a historical import that fabricates a
 *   date from the crawl-time post stamp (Codex adversarial review). The script
 *   now guards with `hasExplicitEventDate` and skips such rows, so a re-apply
 *   yields 13. This removes the one already-written inferred row:
 *
 *     viewtopic.php?p=260#p260 — stored date 2024-02-10 (a back-dated guess).
 *
 * Safety:
 *   HARD-deletes the Event AND its RawEvent (via {@link deleteLeakedEvent}) so
 *   the inferred row can't be recreated by a stray re-merge of a `processed=
 *   false` RawEvent. Refuses to proceed if the Event has any attendance data,
 *   or if a RawEvent from a source other than "Atlanta Hash Board" is attached
 *   (provenance guard). Idempotent — a no-op once the row is gone.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-ah4-inferred-date-event.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-ah4-inferred-date-event.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const SOURCE_NAME = "Atlanta Hash Board";
const KENNEL_CODE = "ah4";
const INFERRED_SOURCE_URL = "https://board.atlantahash.com/viewtopic.php?p=260#p260";

async function main() {
  const apply = process.env.CLEANUP_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will hard-delete)" : "DRY RUN (no writes)"}`);

  const event = await prisma.event.findFirst({
    where: {
      sourceUrl: INFERRED_SOURCE_URL,
      kennel: { kennelCode: KENNEL_CODE },
    },
    select: {
      id: true,
      date: true,
      runNumber: true,
      title: true,
      _count: { select: { attendances: true, kennelAttendances: true } },
    },
  });

  if (!event) {
    console.log("No matching AH4 event found — already cleaned up. Nothing to do.");
    return;
  }

  console.log(
    `Target: ${event.id} | ${event.date.toISOString().slice(0, 10)} | #${event.runNumber ?? "?"} | ${event.title ?? "—"}`,
  );
  console.log(
    `  attendances=${event._count.attendances} kennelAttendances=${event._count.kennelAttendances}`,
  );

  if (!apply) {
    console.log("\nDry run complete. Re-run with CLEANUP_APPLY=1 to hard-delete.");
    return;
  }

  // Resolve the source deterministically — `findFirst` could pick an arbitrary
  // row if a legacy duplicate exists, weakening the provenance guard on this
  // hard-delete. Require exactly one match (CodeRabbit review).
  const sources = await prisma.source.findMany({
    where: { name: SOURCE_NAME },
    select: { id: true },
  });
  if (sources.length === 0) {
    throw new Error(`Source "${SOURCE_NAME}" not found.`);
  }
  if (sources.length > 1) {
    throw new Error(
      `Multiple sources named "${SOURCE_NAME}" (${sources.length}) — aborting to avoid deleting against ambiguous provenance.`,
    );
  }
  const source = sources[0];

  // requireZeroCounts guards user data (attendances); the Event's hares/raws
  // are hard-deleted. forbidForeignRawSourceId asserts only Atlanta Hash Board
  // raws are attached (provenance).
  await deleteLeakedEvent(
    prisma,
    event.id,
    ["attendances", "kennelAttendances"],
    source.id,
  );
  console.log("Done.");
}

main()
  .catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
