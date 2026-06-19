/**
 * One-shot historical backfill for Phnom Penh H3 (phnom-penh-h3).
 *
 * p2h3.com has only a shallow on-site archive: the `/news` collection publishes
 * the most recent ~13 runs as rich `/news/<n>` detail pages (venue + Maps link +
 * distances + hares); out-of-range numbers 302-redirect to the home page. The
 * recurring adapter (config.upcomingOnly) only reads the forward home tables, so
 * these recently-passed runs would never reach canonical Events.
 *
 * This loader fetches the reachable past detail pages (#1829–#1840) and reuses
 * the adapter's exported per-post parser (`parseNewsDetail` + `newsDetailToRawEvent`),
 * then replays them through the merge pipeline. Rows bind to the
 * "Phnom Penh H3 Website" source for provenance.
 *
 * Re-runnable: `reportAndApplyBackfill` partitions to strictly-past rows (date <
 * today in Asia/Phnom_Penh) and `processRawEvents` dedupes by fingerprint.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-phnom-penh-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-phnom-penh-h3-history.ts
 *
 * Requires the "Phnom Penh H3 Website" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseNewsDetail, newsDetailToRawEvent } from "@/adapters/html-scraper/phnom-penh-h3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Phnom Penh H3 Website";
const KENNEL_TIMEZONE = "Asia/Phnom_Penh";
const NEWS_BASE = "https://www.p2h3.com/news/";
// Reachable past detail pages per the on-site /news nav (#1829→#1841). #1841 is
// the current/future run (handled by the live adapter) and is dropped by the
// past-partition; out-of-range numbers redirect to home and parse to no run.
const START_RUN = 1829;
const END_RUN = 1840;

async function fetchHistory(): Promise<RawEventData[]> {
  const events: RawEventData[] = [];
  for (let n = START_RUN; n <= END_RUN; n++) {
    const url = `${NEWS_BASE}${n}`;
    try {
      const res = await safeFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
      });
      if (!res.ok) {
        console.warn(`  /news/${n}: HTTP ${res.status}, skipping`);
        continue;
      }
      const detail = parseNewsDetail(await res.text());
      // Out-of-range numbers 302-redirect to the home page, which carries no
      // "Run No." prose → runNumber stays undefined. Skip those.
      if (detail.runNumber === undefined) {
        console.warn(`  /news/${n}: no run detail (redirect?), skipping`);
        continue;
      }
      const event = newsDetailToRawEvent(detail, url);
      if (event) events.push(event);
    } catch (err) {
      console.warn(`  /news/${n}: ${err}`);
    }
  }
  // Fail loud: if every fetch failed (network outage, all redirected to home),
  // an empty array would let the backfill "succeed" with nothing — surface it.
  if (events.length === 0) {
    throw new Error(
      `No historical events fetched from p2h3.com/news/${START_RUN}-${END_RUN} ` +
        `(all requests failed or returned no run detail).`,
    );
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Fetching p2h3.com /news/${START_RUN}–${END_RUN} detail pages`,
  fetchEvents: fetchHistory,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
