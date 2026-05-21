/**
 * One-shot historical backfill for KL Full Moon H3 (klfullmoonhash.com).
 * Issue #1539.
 *
 * The kennel's Yii GridView hareline at
 *   https://klfullmoonhash.com/index.php?r=site/hareline
 * publishes 144 historical rows (Run #276 / 2015 → #413 / present + 6
 * `runNumber=0` placeholders) across 12 paginated pages of 12 rows each.
 * The recurring `YiiHarelineAdapter` only fetches the last few pages, so
 * ~130 historical runs (#276 → #401) have never landed in HashTracks.
 *
 * **Strategy:** walk every page (page 1 → maxPage), reuse the shared Yii
 * parser, and route through `reportAndApplyBackfill` so the merge pipeline
 * dedupes against the recurring adapter's RawEvents and upserts canonical
 * Events in a single pass.
 *
 * **Run No = 0 handling:** the shared Yii row parser skips `runNumber=0`
 * rows by design (these are tripartite/cancelled placeholders). We mirror
 * that here for behavioral parity with the recurring adapter — adding them
 * would diverge state and require special schema-side handling. The 6
 * dropped rows (3 CANCELLED + 3 tripartite/interhowl) are listed in
 * issue #1539 for the audit log; if we ever want them, file a follow-up.
 *
 * **Idempotency + strict partitioning:** `reportAndApplyBackfill` filters
 * to `date < today (Asia/Kuala_Lumpur)` so the recurring adapter still
 * owns the upcoming window. Fingerprint dedup in `processRawEvents`
 * makes re-runs a no-op.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && npx tsx scripts/backfill-klfmh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-klfmh3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import {
  buildYiiPageUrl,
  extractMaxYiiPage,
  parseYiiHarelinePage,
  type YiiHarelineConfig,
} from "@/adapters/html-scraper/yii-hareline";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "KL Full Moon H3 Hareline";
const BASE_URL = "https://klfullmoonhash.com/index.php?r=site/hareline";
const KENNEL_TIMEZONE = "Asia/Kuala_Lumpur";
const CONFIG: YiiHarelineConfig = { kennelTag: "klfmh3", startTime: "18:00" };

async function fetchPageHtml(pageNum: number): Promise<string> {
  const url = buildYiiPageUrl(BASE_URL, pageNum);
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!res.ok) throw new Error(`Page ${pageNum}: HTTP ${res.status}`);
  return await res.text();
}

async function fetchEvents(): Promise<RawEventData[]> {
  console.warn(`Walking ${BASE_URL} (Yii GridView, every page)`);
  const page1Html = await fetchPageHtml(1);
  const maxPage = extractMaxYiiPage(page1Html);
  console.warn(`  Discovered maxPage = ${maxPage}`);

  const allEvents: RawEventData[] = parseYiiHarelinePage(
    cheerio.load(page1Html),
    CONFIG,
    BASE_URL,
  );

  for (let p = 2; p <= maxPage; p++) {
    const html = await fetchPageHtml(p);
    const events = parseYiiHarelinePage(cheerio.load(html), CONFIG, BASE_URL);
    allEvents.push(...events);
  }
  console.warn(`  Raw rows parsed across ${maxPage} pages: ${allEvents.length}`);

  // Dedupe by (runNumber, date) — the recurring adapter does the same; page
  // tails can overlap if a row is added mid-walk.
  const seen = new Set<string>();
  const unique: RawEventData[] = [];
  for (const e of allEvents) {
    const key = `${e.runNumber ?? ""}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  console.warn(`  Unique events after dedupe: ${unique.length}`);
  return unique;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking klfullmoonhash.com Yii hareline (every page)`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
