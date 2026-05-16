/**
 * One-shot historical backfill for KJ Harimau (Kelana Jaya Harimau H3, Malaysia).
 * Issue #1447.
 *
 * khhhkj.blogspot.com publishes weekly run announcements (plus
 * birthday/wedding posts which the adapter filters out). The recurring
 * KjHarimauAdapter uses Blogger's default `maxResults=25` (sane for daily
 * scrapes); this script drives the same adapter with `maxResults=500` so
 * the whole visible archive comes back in one pass (~40 distinct runs
 * back to Run#1514 / 2025-08-19).
 *
 * Why drive the adapter directly:
 *   The adapter's `fetch()` method already owns the canonical post→event
 *   composition (Blogger fetch → title-regex filter → body/title parse →
 *   completeness-score dedup → RawEventData build). Re-implementing it in
 *   the backfill script would duplicate ~40 lines and risk drift from
 *   future #1446-class parser fixes. Instead, the adapter exposes a
 *   `maxResults` knob on its `fetch` options so this script can request
 *   a deeper window without forking the composition logic.
 *
 * Idempotency:
 *   The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)`. The
 *   fingerprint is deterministic over the parsed payload, so a second apply
 *   pass is a no-op on every row.
 *
 * Coverage limit:
 *   Blogger only returns posts visible on the front page + paginated
 *   archive (up to maxResults=500). Very old posts may have rolled off.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && npx tsx scripts/backfill-kj-harimau-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-kj-harimau-history.ts
 *   Env:      DATABASE_URL, GOOGLE_CALENDAR_API_KEY (Blogger API v3 shares the key)
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { KjHarimauAdapter } from "@/adapters/html-scraper/kj-harimau";
import type { Source } from "@/generated/prisma/client";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "KJ Harimau H3 Blog";
const BASE_URL = "https://khhhkj.blogspot.com";
const KENNEL_TIMEZONE = "Asia/Kuala_Lumpur";
const WIDE_DAYS = 365 * 20;
const MAX_BLOGGER_POSTS = 500;

async function fetchEvents(): Promise<RawEventData[]> {
  const adapter = new KjHarimauAdapter();
  // Synthetic Source — adapter.fetch only reads url + scrapeDays. The cast
  // keeps the script independent of Source schema fields the adapter
  // doesn't touch (lastScrapeAt, healthStatus, etc.).
  const syntheticSource = {
    url: BASE_URL,
    scrapeDays: WIDE_DAYS,
  } as Source;
  console.warn(
    `Driving KjHarimauAdapter against ${BASE_URL} (days=${WIDE_DAYS}, maxResults=${MAX_BLOGGER_POSTS})`,
  );
  const result = await adapter.fetch(syntheticSource, {
    days: WIDE_DAYS,
    maxResults: MAX_BLOGGER_POSTS,
  });
  if (result.errors.length > 0) {
    console.warn(`  Adapter reported ${result.errors.length} parse errors (non-fatal):`);
    for (const e of result.errors.slice(0, 5)) console.warn(`    - ${e}`);
  }
  console.warn(`  Adapter returned ${result.events.length} events.`);
  return result.events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking khhhkj.blogspot.com via KjHarimauAdapter (max ${MAX_BLOGGER_POSTS})`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
