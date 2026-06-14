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
 * return). Instead this walks the archive index and reuses the SAME
 * `parseNextRunArticle` the adapter uses — its comment documents that it handles
 * the archive `.com-content-article__body` template, so no parser fork — then
 * routes the strictly-past slice through the live merge pipeline.
 *
 * Mirrors `scripts/backfill-bth3-history.ts` (same site, sibling kennel): single
 * `?limit=0` "show-all" index fetch + concurrency pool + failure cap. The one
 * divergence is the User-Agent — the /siamsunday archive's WAF 403s the shared
 * "compatible; HashTracks-Backfill" UA that /thursday accepts, so this script
 * sends a plain desktop-browser UA (verified against the live site).
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
import { safeFetch } from "@/adapters/safe-fetch";
import { parseNextRunArticle } from "@/adapters/html-scraper/bangkokhash";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Siam Sunday Hash";
const KENNEL_TIMEZONE = "Asia/Bangkok";
const KENNEL_TAG = "s2h3";
const DEFAULT_TIME = "16:30";

const BASE_URL = "https://www.bangkokhash.com";
const INDEX_URL = `${BASE_URL}/siamsunday/index.php/run-archives-s2h3?limit=0`;
const DETAIL_URL_RE = /\/siamsunday\/index\.php\/run-archives-s2h3\/\d+-run-\d+/g;

// Unlike the BTH3/BFMH3 archives, the /siamsunday archive's WAF 403s the shared
// "compatible; HashTracks-Backfill" UA — a plain desktop-browser UA is accepted
// (verified against the live site).
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html",
};
const FETCH_CONCURRENCY = 4;
const MAX_TOTAL_FAILURES = 10;

async function fetchText(url: string): Promise<string | null> {
  const res = await safeFetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    console.warn(`  HTTP ${res.status} for ${url}`);
    return null;
  }
  return res.text();
}

async function discoverDetailUrls(): Promise<string[]> {
  console.log(`  Fetching index: ${INDEX_URL}`);
  const html = await fetchText(INDEX_URL);
  if (!html) throw new Error("Failed to fetch S2H3 archive index");
  const matches = html.match(DETAIL_URL_RE) ?? [];
  return [...new Set(matches)]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => `${BASE_URL}${path}`);
}

async function fetchAllArchive(): Promise<RawEventData[]> {
  const urls = await discoverDetailUrls();
  console.log(`  Discovered ${urls.length} detail URLs`);

  const events: RawEventData[] = [];
  let failures = 0;
  let nextIdx = 0;
  let processed = 0;
  let aborted = false;
  let abortReason = "";

  async function worker(): Promise<void> {
    while (!aborted) {
      const i = nextIdx++;
      if (i >= urls.length) return;
      const url = urls[i];
      const html = await fetchText(url);
      if (!html) {
        failures++;
        if (failures >= MAX_TOTAL_FAILURES) {
          aborted = true;
          abortReason = `${failures} total fetch failures (limit ${MAX_TOTAL_FAILURES})`;
        }
        continue;
      }
      const event = parseNextRunArticle(html, KENNEL_TAG, DEFAULT_TIME, url);
      if (event) {
        events.push(event);
      } else {
        console.warn(`  Skipped (no parse): ${url}`);
      }
      processed++;
      if (processed % 25 === 0) {
        console.log(`  Progress: ${processed}/${urls.length} fetched, ${events.length} parsed`);
      }
    }
  }

  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  if (aborted) throw new Error(`Aborted: ${abortReason}`);
  events.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  Final: ${processed}/${urls.length} fetched, ${events.length} parsed`);
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking S2H3 archive",
  fetchEvents: fetchAllArchive,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
