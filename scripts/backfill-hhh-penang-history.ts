/**
 * One-shot historical backfill for Hash House Harriets Penang (issue #1282).
 *
 * The live `GoHashAdapter` fetches `/hareline/upcoming` (forward-only — the
 * source's recurring adapter pins `upcomingOnly: true` so past rows that fall
 * off the page aren't reconciled away). The same goHash tenant also exposes
 * `/hareline/past`, which carries the kennel's historical archive (~70 runs
 * as of #1282). This wrapper hits that endpoint once, runs each row through
 * the shared `parseGoHashRun` helper, and pipes them into the merge pipeline
 * via `runBackfillScript`.
 *
 * Strict date partitioning: `reportAndApplyBackfill` filters to
 * `date < today-in-Asia/Kuala_Lumpur`. Re-runs are no-ops via fingerprint
 * dedup in `processRawEvents`.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-hhh-penang-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-hhh-penang-history.ts
 *   Env:      DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { extractInitialState, parseGoHashRun } from "@/adapters/html-scraper/gohash";
import { fetchHTMLPage } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Hash House Harriets Penang Hareline";
const KENNEL_TIMEZONE = "Asia/Kuala_Lumpur";
const HARELINE_URL = "https://www.hashhouseharrietspenang.com/hareline/past";
const KENNEL_TAG = "hhhpenang";
const START_TIME = "17:30";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching ${HARELINE_URL}`);
  const page = await fetchHTMLPage(HARELINE_URL);
  if (!page.ok) {
    throw new Error(
      `Failed to fetch ${HARELINE_URL}: ${page.result.errors.join("; ")}`,
    );
  }

  const state = extractInitialState(page.html);
  if (!state) {
    throw new Error(
      `__INITIAL_STATE__ not found at ${HARELINE_URL} — page shape may have drifted`,
    );
  }

  const rawRuns = state.runs?.runs ?? [];
  const events: RawEventData[] = [];
  let skipped = 0;
  for (const run of rawRuns) {
    const event = parseGoHashRun(
      run,
      { kennelTag: KENNEL_TAG, startTime: START_TIME },
      HARELINE_URL,
    );
    if (event) events.push(event);
    else skipped++;
  }
  console.log(
    `  Found ${rawRuns.length} raw runs, parsed ${events.length}, skipped ${skipped} (missing/invalid date)`,
  );
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking ${HARELINE_URL}`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
