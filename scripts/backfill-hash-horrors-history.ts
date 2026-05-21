/**
 * One-shot historical backfill for Hash House Horrors (Singapore).
 * Issue #1252.
 *
 * The kennel's WordPress.com `/hareline` page carries ~240 numbered runs
 * spanning 1993-08-08 (#248) → present (#1014). The recurring adapter
 * (`HashHorrorsAdapter`) only ingests `options.days` worth of events per
 * scrape (typically 365 via `Source.scrapeDays`), so before this backfill
 * HashTracks held just 23 past events vs. the source's ~240-run lifetime
 * archive.
 *
 * Strategy:
 *   1. Fetch the `/hareline` page via the WP.com Public REST API (same call
 *      the live adapter uses).
 *   2. Parse rows with `parseHashHorrorsHareline` (year-anchored archive
 *      walker) — kept colocated with the live adapter so any format-drift
 *      fix flows to both the recurring scrape and the backfill at once.
 *   3. Attribute every row to the existing "Hash House Horrors Hareline"
 *      source, which is already `SourceKennel`-linked to `hhhorrors`.
 *   4. `runBackfillScript` partitions to past-only (date < today in
 *      Asia/Singapore) and routes through the merge pipeline.
 *
 * Idempotency:
 *   `processRawEvents` dedupes by `(sourceId, fingerprint)`. The fingerprint
 *   is deterministic over the parsed payload, so a second apply pass is a
 *   no-op. Hares values are a single string per row (no joined multi-value
 *   field), so there's no ordering risk to worry about.
 *
 * Strict date partitioning vs. the live adapter:
 *   `reportAndApplyBackfill` filters to `date < todayInTimezone(SGT)`. The
 *   live adapter scrapes the same `/hareline` page but is bounded by
 *   `Source.scrapeDays` (~365), so the two paths can both produce a row
 *   for the same recent past event — same fingerprint, dedup absorbs it.
 *
 * Reconcile risk:
 *   None for the deep history. `src/pipeline/reconcile.ts` only cancels
 *   future events missing from a scrape; past events are immutable once
 *   ingested.
 *
 * Coverage limit:
 *   The archive page itself carries some real format drift on the oldest
 *   rows (e.g. #248-#249 from 1993 have reversed hares/location, #527 has
 *   no date in the row text). Those ~10 rows surface as scraper "format
 *   drift" warnings rather than backfilled events — see issue #1253 for
 *   the parser fix that recovered the bulk of the archive (199→288 rows).
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-hash-horrors-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-hash-horrors-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import {
  flattenHashHorrorsPageText,
  parseHashHorrorsHareline,
} from "@/adapters/html-scraper/hash-horrors";
import { fetchWordPressComPage } from "@/adapters/wordpress-api";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Hash House Horrors Hareline";
const KENNEL_TIMEZONE = "Asia/Singapore";
const SITE_DOMAIN = "hashhousehorrors.com";
const HARELINE_SLUG = "hareline";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching https://${SITE_DOMAIN}/${HARELINE_SLUG}/ via WP.com API`);
  const result = await fetchWordPressComPage(SITE_DOMAIN, HARELINE_SLUG);
  if (result.error || !result.page) {
    throw new Error(`WP.com API fetch failed: ${result.error?.message ?? "no page returned"}`);
  }

  const pageUrl = result.page.URL || `https://${SITE_DOMAIN}/${HARELINE_SLUG}/`;
  const text = flattenHashHorrorsPageText(result.page.content);
  const parsed = parseHashHorrorsHareline(text);
  console.log(
    `  Parsed ${parsed.events.length} rows | skippedLines=${parsed.skippedLines} | skippedMarkers=${parsed.skippedMarkers}`,
  );
  if (parsed.skippedLines > 0) {
    console.warn(
      `  (${parsed.skippedLines} rows surfaced as format drift — see issue #1252 / #1253 for the recovered subset.)`,
    );
  }
  return parsed.events.map((e) => ({ ...e, sourceUrl: pageUrl }));
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking Hash Horrors hareline archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
