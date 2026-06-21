/**
 * One-shot historical backfill for Saigon H3 (saigon-h3).
 *
 * saigonhashers.com/runs (Run Stats) is a fully server-rendered table of the
 * kennel's past runs (~800 rows: numbers | Date | Name/Occasion | Pack Size |
 * Hares | A-Site | On-On). The recurring adapter (config.upcomingOnly) only
 * reads the forward /hareline feed, so these passed runs would never reach
 * canonical Events.
 *
 * This loader fetches /runs and reuses the adapter's exported `parseRunsArchive`
 * (which applies the same title discrimination + hare cleaning as the live
 * adapter), then replays the strictly-past rows through the merge pipeline. Rows
 * bind to the "Saigon H3 Website" source for provenance. `config.upcomingOnly`
 * keeps reconcile from cancelling these past events.
 *
 * Re-runnable: `reportAndApplyBackfill` partitions to strictly-past rows (date <
 * today in Asia/Ho_Chi_Minh) and `processRawEvents` dedupes by fingerprint.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-saigon-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-saigon-h3-history.ts
 *
 * Requires the "Saigon H3 Website" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { fetchHTMLPage } from "@/adapters/utils";
import { parseRunsArchive } from "@/adapters/html-scraper/saigon-h3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Saigon H3 Website";
const KENNEL_TIMEZONE = "Asia/Ho_Chi_Minh";
const RUNS_URL = "https://saigonhashers.com/runs";

async function fetchHistory(): Promise<RawEventData[]> {
  const page = await fetchHTMLPage(RUNS_URL);
  if (!page.ok) {
    throw new Error(`Failed to fetch ${RUNS_URL}: ${page.result.errors.join("; ")}`);
  }
  const events = parseRunsArchive(page.html, RUNS_URL);
  // Fail loud: an empty parse means markup drift (or a JS-rendered fallback),
  // not a legitimately-empty archive — surface it rather than "succeeding" with
  // nothing.
  if (events.length === 0) {
    throw new Error(
      `No historical runs parsed from ${RUNS_URL} (markup drift or non-SSR fallback?).`,
    );
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Fetching saigonhashers.com/runs archive",
  fetchEvents: fetchHistory,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
