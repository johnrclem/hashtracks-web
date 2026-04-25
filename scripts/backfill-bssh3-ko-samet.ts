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
 * Usage:
 *   1. Dry run first:  npx tsx scripts/backfill-bssh3-ko-samet.ts
 *   2. Execute:        BACKFILL_APPLY=1 npx tsx scripts/backfill-bssh3-ko-samet.ts
 */

import "dotenv/config";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
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

  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events: KO_SAMET_EVENTS,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
