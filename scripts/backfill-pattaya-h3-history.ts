/**
 * One-shot historical backfill for Pattaya H3 (issue #1927).
 *
 * The live `PattayaH3Adapter` scrapes the hareline (HareLine.php), which only
 * ever shows upcoming/recent runs — so HashTracks holds just the handful of
 * runs scraped while they were upcoming. The kennel also maintains a complete
 * run-reports archive at RunReports.php listing every run #1 (7 Jan 1984)
 * through the latest, with date, run number, hares, attendee count, and (for
 * recent runs) an A-Site with GPS.
 *
 * This wrapper fetches that archive once, parses it with
 * `parsePattayaRunReports`, and pipes the rows into the merge pipeline via
 * `runBackfillScript`. It binds to the existing "Pattaya H3 Hareline" source
 * (same site, archive URL path) — the BTH3 precedent (backfill-bth3-history.ts)
 * — so provenance stays with the live source while each event keeps its own
 * per-run `RunReportLkup.php?run_num=N` `sourceUrl`.
 *
 * Strict date partitioning: `reportAndApplyBackfill` filters to
 * `date < today-in-Asia/Bangkok`, so only historical runs are inserted; the
 * few overlapping recent runs already in the DB merge into the same canonical
 * Event by (kennel, date). Re-runs are no-ops via fingerprint dedup in
 * `processRawEvents`.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-pattaya-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-pattaya-h3-history.ts
 *   Env:      DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import {
  PH3_RUN_REPORTS_URL,
  parsePattayaRunReports,
} from "@/adapters/html-scraper/pattaya-h3";
import { fetchHTMLPage } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Pattaya H3 Hareline";
const KENNEL_TIMEZONE = "Asia/Bangkok";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching ${PH3_RUN_REPORTS_URL}`);
  const page = await fetchHTMLPage(PH3_RUN_REPORTS_URL);
  if (!page.ok) {
    throw new Error(
      `Failed to fetch ${PH3_RUN_REPORTS_URL}: ${page.result.errors.join("; ")}`,
    );
  }

  const events = parsePattayaRunReports(page.html);
  if (events.length === 0) {
    throw new Error(
      `Parsed 0 events from ${PH3_RUN_REPORTS_URL} — page shape may have drifted`,
    );
  }
  const withRun = events.filter((e) => e.runNumber !== undefined).length;
  console.log(`  Parsed ${events.length} events (${withRun} with a run number)`);
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking ${PH3_RUN_REPORTS_URL}`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
