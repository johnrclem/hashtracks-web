/**
 * One-shot historical backfill for Bangkok Sabai Saturday Hash (BSSH3).
 *
 * Runs 10 and 11 (Ko Samet outstation weekend, May 30–31 2025) are missing
 * from HashTracks because BSSH3's only source is Meetup and the kennel never
 * posted these two outstation runs on Meetup. Per issue #915, recommendation
 * is a one-shot RawEvent insert — widening the Meetup scrape window can't
 * surface events that never lived on Meetup.
 *
 * Binding these RawEvents to the existing "BSSH3 Meetup" source preserves
 * kennel provenance; the merge pipeline resolves the canonical Event via
 * `kennelTag`, not source identity. The Meetup adapter scrapes 90 days
 * forward only, so it cannot race these past rows.
 *
 * Partition (per `.claude/rules/adapter-patterns.md`):
 *   - Adapter handles dates >= CURDATE()
 *   - This script handles dates < CURDATE() (these events are May 2025)
 * Always re-runnable: fingerprint-based dedup against existing RawEvents.
 *
 * Usage:
 *   1. Dry run first:  npx tsx scripts/backfill-bssh3-ko-samet.ts
 *   2. Execute:        BACKFILL_APPLY=1 npx tsx scripts/backfill-bssh3-ko-samet.ts
 */

import "dotenv/config";
import { insertRawEventsForSource } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";

const KENNEL_CODE = "bssh3";
const SOURCE_NAME = "BSSH3 Meetup";
const KENNEL_TIMEZONE = "Asia/Bangkok";
const DEFAULT_START_TIME = "13:45"; // BSSH3's standard meet time

/**
 * Verbatim from https://bangkoksaturdayhash.com/past-events (issue #915):
 *   "Run 10 - 30 May 25 (Ko Samet)"
 *   "Run 11 - 31 May 25 (Ko Samet)"
 * Canonical titles aren't displayed on the past-events page; we use the
 * short-form title shown verbatim on the source.
 */
const KO_SAMET_EVENTS: RawEventData[] = [
  {
    date: "2025-05-30",
    kennelTag: KENNEL_CODE,
    runNumber: 10,
    title: "Run 10 - Ko Samet",
    location: "Ko Samet",
    startTime: DEFAULT_START_TIME,
  },
  {
    date: "2025-05-31",
    kennelTag: KENNEL_CODE,
    runNumber: 11,
    title: "Run 11 - Ko Samet",
    location: "Ko Samet",
    startTime: DEFAULT_START_TIME,
  },
];

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  // en-CA emits ISO YYYY-MM-DD; compare against RawEventData.date (also ISO).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: KENNEL_TIMEZONE }).format(new Date());
  const allEvents = KO_SAMET_EVENTS.filter((e) => {
    if (e.date >= today) {
      console.log(`Skipping ${e.title}: date ${e.date} >= today ${today} (adapter territory)`);
      return false;
    }
    return true;
  });

  console.log(`\nEvents to insert: ${allEvents.length}`);
  for (const e of allEvents) {
    console.log(`  #${e.runNumber} ${e.date} | ${e.title} | loc=${e.location} | start=${e.startTime}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  if (allEvents.length === 0) {
    console.log("No events to insert. Exiting.");
    return;
  }

  const { preExisting, inserted } = await insertRawEventsForSource(SOURCE_NAME, allEvents);
  console.log(`\nPre-existing rows: ${preExisting}. New rows to insert: ${inserted}.`);

  if (inserted === 0) {
    console.log("Nothing new to insert. Exiting.");
    return;
  }

  console.log(`\nDone. Inserted ${inserted} new RawEvents for source "${SOURCE_NAME}".`);
  console.log("Trigger a scrape of this source from the admin UI to merge the new RawEvents into canonical Events.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
