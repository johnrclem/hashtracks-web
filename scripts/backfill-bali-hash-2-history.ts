/**
 * One-shot historical backfill for Bali Hash 2 (`bali-hash-2`).
 *
 * The live adapter (`src/adapters/html-scraper/bali-hash-2.ts`) only emits the
 * recent + upcoming hareline (the home page's ~12–22 most-recent run posts).
 * The kennel's Ghost blog keeps the full archive (~1,747 runs back to the late
 * 1970s) on paginated `/page/N/` listings.
 *
 * This walks every listing page, reuses the adapter's own parsers
 * (`parseListingCards` → `parseDetailFields` → `buildEvent`) so there is no
 * parser fork, and routes the PAST slice through the shared backfill runner.
 * `reportAndApplyBackfill` partitions strictly on date < today-in-Bali so the
 * recurring adapter (date >= today) and this backfill never overlap — the
 * script is safe to re-run (the merge pipeline dedupes by fingerprint).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-bali-hash-2-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bali-hash-2-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import {
  parseListingCards,
  parseDetailFields,
  dedupeByRunNumber,
  buildEvent,
  type BaliListingEntry,
} from "@/adapters/html-scraper/bali-hash-2";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Bali Hash 2 Website";
const KENNEL_TIMEZONE = "Asia/Makassar";
const BASE_URL = "https://balihash2.com/";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
  Accept: "text/html",
};
const MAX_PAGES = 250; // ~1,747 runs / ~12 per page ≈ 150; generous safety cap.
const DETAIL_CONCURRENCY = 4;
const MAX_DETAIL_FAILURES = 25;

async function fetchText(url: string): Promise<string | null> {
  const res = await safeFetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    if (res.status !== 404) console.warn(`  HTTP ${res.status} for ${url}`);
    return null;
  }
  return res.text();
}

/** Walk `/`, `/page/2/`, … until a page 404s or yields no run posts. */
async function discoverEntries(): Promise<BaliListingEntry[]> {
  const entries: BaliListingEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? BASE_URL : `${BASE_URL}page/${page}/`;
    const html = await fetchText(url);
    if (!html) break;
    const pageEntries = parseListingCards(html);
    if (pageEntries.length === 0) break;
    entries.push(...pageEntries);
    if (page % 10 === 0) console.log(`  Walked ${page} pages, ${entries.length} posts so far`);
  }
  // Reassign a global DOM index (page 1 = newest) so dedupeByRunNumber keeps the
  // most-recently-published post for any run that appears more than once.
  entries.forEach((e, i) => {
    e.domIndex = i;
  });
  return dedupeByRunNumber(entries).filter((e) => e.date);
}

async function fetchAllArchive(): Promise<RawEventData[]> {
  const entries = await discoverEntries();
  console.log(`  Discovered ${entries.length} dated, deduped run posts`);

  const events: RawEventData[] = [];
  let failures = 0;
  let nextIdx = 0;
  let processed = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (!aborted) {
      const i = nextIdx++;
      if (i >= entries.length) return;
      const entry = entries[i];
      const html = await fetchText(entry.url);
      if (!html) {
        failures++;
        if (failures >= MAX_DETAIL_FAILURES) {
          aborted = true;
          return;
        }
        // No detail page — still emit from listing data (date is guaranteed).
        events.push(buildEvent(entry, null));
        continue;
      }
      events.push(buildEvent(entry, parseDetailFields(html)));
      processed++;
      if (processed % 50 === 0) {
        console.log(`  Detail: ${processed}/${entries.length} fetched, ${events.length} built`);
      }
    }
  }

  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
  if (aborted) {
    throw new Error(`Aborted: ${failures} detail-page fetch failures (limit ${MAX_DETAIL_FAILURES})`);
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  Final: ${events.length} events parsed`);
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking Bali Hash 2 archive",
  fetchEvents: fetchAllArchive,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
