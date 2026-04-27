/**
 * One-shot historical backfill for BTH3 (Bangkok Thursday H3). Issue #987.
 *
 * The live BTH3 adapter scrapes the Hareline sidebar widget on the
 * homepage (currently captures 1 past event). The kennel's public Run
 * Archives expose 222 detail pages (Run #298 → #520) at:
 *   /thursday/index.php/run-archives-bth3/{joomla-id}-run-{NNN}
 *
 * Reuses `parseNextRunArticle` from the BTH3 adapter — its own comment
 * documents that it handles both the homepage `.item-content` and the
 * archive `.com-content-article__body` template, so no parser fork.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-bth3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bth3-history.ts
 */

import "dotenv/config";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseNextRunArticle } from "@/adapters/html-scraper/bangkokhash";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Bangkok Thursday Hash";
const KENNEL_TIMEZONE = "Asia/Bangkok";
const KENNEL_TAG = "bth3";
const DEFAULT_TIME = "18:30";

const BASE_URL = "https://www.bangkokhash.com";
const INDEX_URL = `${BASE_URL}/thursday/index.php/run-archives-bth3?limit=0`;
const DETAIL_URL_RE = /\/thursday\/index\.php\/run-archives-bth3\/\d+-run-\d+/g;

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
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
  if (!html) throw new Error("Failed to fetch BTH3 archive index");
  const matches = html.match(DETAIL_URL_RE) ?? [];
  return [...new Set(matches)].sort().map((path) => `${BASE_URL}${path}`);
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

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  console.log("\n[1/2] Walking BTH3 archive...");
  const events = await fetchAllArchive();
  console.log(`  Total parsed: ${events.length}`);

  console.log("\n[2/2] Reporting + applying...");
  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
