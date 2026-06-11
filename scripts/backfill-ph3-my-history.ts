/**
 * One-shot historical backfill for Petaling H3 (`ph3-my`).
 *
 * The recurring `YiiHarelineAdapter` only fetches the last few pages of the
 * ph3.org Yii GridView hareline each scrape (the upcoming/recent window). The
 * source enumerates ~1,160 runs back to 2003 (#2085) across ~90 paginated
 * pages. This walks every page, reuses the adapter's own parser
 * (`parseYiiHarelinePage`, so there is no parser fork — the Occasion → title /
 * description split from #2084 comes along for free), and routes the PAST slice
 * through the shared backfill runner.
 *
 * `reportAndApplyBackfill` partitions strictly on `date < today-in-KL` so the
 * recurring adapter (date >= today) and this backfill never overlap, and the
 * merge pipeline dedupes by fingerprint — the script is safe to re-run. Because
 * the merge UPDATE branch fires when a fingerprint changes, re-merging the
 * in-window past rows also heals any stale placeholder titles (#2084).
 *
 * Usage:
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-ph3-my-history.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-ph3-my-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import {
  buildYiiPageUrl,
  dedupeYiiEvents,
  discoverMaxYiiPage,
  parseYiiHarelinePage,
  type YiiHarelineConfig,
} from "@/adapters/html-scraper/yii-hareline";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Petaling H3 Hareline";
const KENNEL_TIMEZONE = "Asia/Kuala_Lumpur";
const BASE_URL = "https://ph3.org/index.php?r=site/hareline";
const CONFIG: YiiHarelineConfig = { kennelTag: "ph3-my", startTime: "16:00" };

const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" };

/** Fetch one hareline page; return parsed events + raw HTML (page 1's HTML is
 *  needed to discover the pagination max). Pass the canonical BASE_URL (not the
 *  per-page URL) to the parser so fingerprints match the recurring adapter. */
async function fetchPage(pageNum: number): Promise<{ events: RawEventData[]; html: string }> {
  const res = await safeFetch(buildYiiPageUrl(BASE_URL, pageNum), { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`Page ${pageNum}: HTTP ${res.status}`);
  const html = await res.text();
  return { events: parseYiiHarelinePage(cheerio.load(html), CONFIG, BASE_URL), html };
}

async function fetchAllPages(): Promise<RawEventData[]> {
  const { events: page1Events, html } = await fetchPage(1);
  const maxPage = discoverMaxYiiPage(html);
  console.log(`  Discovered maxPage = ${maxPage} (page 1: ${page1Events.length} events)`);

  const all: RawEventData[] = [...page1Events];
  for (let p = 2; p <= maxPage; p++) {
    const { events } = await fetchPage(p);
    all.push(...events);
    if (p % 10 === 0 || p === maxPage) {
      console.log(`  page ${p}/${maxPage}: +${events.length} (total ${all.length})`);
    }
  }

  // Dedupe (page tails can overlap if a row was added between fetches) using
  // the same (runNumber|date) key as the recurring adapter, then sort by date.
  const unique = dedupeYiiEvents(all);
  unique.sort((a, b) => a.date.localeCompare(b.date));
  return unique;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking Petaling H3 (ph3.org) Yii hareline archive",
  fetchEvents: fetchAllPages,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
