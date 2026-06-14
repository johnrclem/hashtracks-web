/**
 * One-shot historical backfill for Siam Sunday H3 (`s2h3`, Bangkok). Issue #2190.
 *
 * The live adapter (BangkokHashAdapter, subSite "siamsunday") only surfaces the
 * next run plus a small future window from the PHP hareline API, so HashTracks
 * holds just a handful of recent S2H3 runs. The kennel's public Run Archives
 * expose every past run as an individual Joomla detail page (Run #520 → #657) at
 *   /siamsunday/index.php/run-archives-s2h3/{joomla-id}-run-{NNN}
 * carrying the full field set: headline title ("Run #NNN, <Location>"), date,
 * start time, hare, cohare, location, and Google Maps link.
 *
 * Widening the adapter's scrape window is unsafe (the live index only lists the
 * next run, so reconcile would cancel every archived run the adapter didn't
 * return). Instead this walks the archive (via the shared `walkJoomlaArchive`
 * helper, same as backfill-bth3-history.ts) and reuses the SAME
 * `parseNextRunArticle` the adapter uses — its comment documents that it handles
 * the archive `.com-content-article__body` template, so no parser fork — then
 * routes the strictly-past slice through the live merge pipeline.
 *
 * Idempotency: `processRawEvents` dedupes by fingerprint — re-running writes no
 * new rows. Reuses the existing "Siam Sunday Hash" source (already linked to
 * `s2h3`), so no new Source row and no reconcile impact (past-dated rows fall
 * outside the live scrape/cancel window — same pattern as SDH3 / Seletar).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-s2h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-s2h3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { walkJoomlaArchive } from "./lib/joomla-archive-backfill";
import { parseNextRunArticle } from "@/adapters/html-scraper/bangkokhash";

const SOURCE_NAME = "Siam Sunday Hash";
const KENNEL_TIMEZONE = "Asia/Bangkok";
const KENNEL_TAG = "s2h3";
const DEFAULT_TIME = "16:30";

const BASE_URL = "https://www.bangkokhash.com";
const INDEX_URL = `${BASE_URL}/siamsunday/index.php/run-archives-s2h3?limit=0`;
const DETAIL_URL_RE = /\/siamsunday\/index\.php\/run-archives-s2h3\/\d+-run-\d+/g;

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking S2H3 archive",
  fetchEvents: () =>
    walkJoomlaArchive({
      baseUrl: BASE_URL,
      indexUrl: INDEX_URL,
      detailUrlRe: DETAIL_URL_RE,
      parse: (html, url) => parseNextRunArticle(html, KENNEL_TAG, DEFAULT_TIME, url),
    }),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
