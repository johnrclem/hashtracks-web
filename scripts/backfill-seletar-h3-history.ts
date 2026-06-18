/**
 * One-shot historical backfill for Seletar H3 (Singapore).
 *
 * The recurring SeletarH3Adapter pulls only future events via UPCOMING_SQL
 * (`hl_datetime >= CURDATE()`); this script reaches back to 1980-06-24 (the
 * kennel's founding) via HISTORICAL_SQL (`hl_datetime < CURDATE()`) and ingests
 * every historical trail in one shot. The two queries are strictly disjoint by
 * date, so the backfill cannot overlap or duplicate what the recurring adapter
 * writes.
 *
 * Refactor history:
 *   The original script (PR #543) inserted RawEvents directly via
 *   `prisma.rawEvent.createMany()` with `processed: false`. That left the rows
 *   orphaned — `scrapeSource` only merges the live adapter's fetch results, so
 *   pre-inserted historical RawEvents never became canonical Events (the same
 *   trap documented in `backfill-runner.ts` and the kljh3 refactor). This
 *   version routes through `runBackfillScript` → `reportAndApplyBackfill` →
 *   `processRawEvents`, which:
 *     - partitions strictly to `date < today-in-Asia/Singapore`,
 *     - dedupes by `(sourceId, fingerprint)` (idempotent re-runs), and
 *     - upserts canonical Events in the same pass.
 *
 * Reconcile note: the recurring adapter is future-only and the "Seletar H3 PWA"
 * source is not `upcomingOnly`, so reconcile would cancel sole-source events in
 * its `now±scrapeDays` window that the live scrape doesn't re-emit. The deep
 * archive (older than the window) is unaffected; the most-recent runs are made
 * reconcile-safe by setting `upcomingOnly: true` on the source config (tracked
 * separately — that lives in prisma/seed-data/sources.ts).
 *
 * Shared logic: fetch + grouping live in src/adapters/html-scraper/seletar-h3.ts
 * (`fetchSeletarRows`, `groupSeletarRows`) so this script and the recurring
 * adapter agree on the API contract, PII filtering, and field mapping.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-seletar-h3-history.ts
 *   Execute:  BACKFILL_APPLY=1 npx tsx scripts/backfill-seletar-h3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import {
  fetchSeletarRows,
  groupSeletarRows,
  HISTORICAL_SQL,
  SELETAR_API_URL_DEFAULT,
} from "@/adapters/html-scraper/seletar-h3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Seletar H3 PWA";
const KENNEL_TIMEZONE = "Asia/Singapore";

async function fetchEvents(): Promise<RawEventData[]> {
  // The one-shot script uses the default API endpoint (unchanged since the
  // kennel was founded). If it ever moves, update SELETAR_API_URL_DEFAULT in
  // the adapter so both this script and the recurring scrape follow.
  console.log(`Fetching historical rows from ${SELETAR_API_URL_DEFAULT} …`);
  const result = await fetchSeletarRows(SELETAR_API_URL_DEFAULT, HISTORICAL_SQL);
  if (result.error) {
    throw new Error(`HashController API failed: ${result.error.message}`);
  }
  console.log(`  Fetched ${result.rows.length} historical rows (hl_datetime < CURDATE).`);

  const grouped = groupSeletarRows(result.rows);
  console.log(
    `  Grouped into ${grouped.events.length} unique runs (skipped ${grouped.skippedRows} malformed rows).`,
  );
  return grouped.events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking Seletar H3 HashController.php archive (1980→present)",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
