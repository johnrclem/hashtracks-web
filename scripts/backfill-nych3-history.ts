/**
 * One-shot historical backfill for the HashNYC receding hareline archive.
 *
 * The live adapter only ingests the next/last `scrapeDays` window AND hard-floors
 * at year 2016, so HashTracks coverage stops at NYCH3 #1669 (Jan 2016). The full
 * archive at `?days=all&backwards=true` exposes ~4,400 rows back to ~1998
 * (NYC #920–#2151 plus the sibling NYC kennels the source feeds), which would
 * never reach canonical Events through normal scrapes. (#1793)
 *
 * Reuses the adapter's exported `parseRows` (with a lowered `minYear`) so field
 * extraction stays in lockstep with the live adapter. The whole archive is
 * inserted — the per-event source-kennel guard in the merge pipeline only admits
 * the 11 kennels actually linked to the HashNYC source, so this is safe.
 *
 * Re-runnable: `reportAndApplyBackfill` routes through `processRawEvents`, which
 * dedupes by fingerprint and partitions to `date < today` (dropping the future
 * rows the combined archive table also contains).
 *
 * Prerequisite: run `npx prisma db seed` first so the HashNYC source is linked
 * to all 12 kennels it feeds (incl. `drinking-practice-nyc`). Otherwise the
 * ~24 archive Drinking Practice rows are blocked by the per-event source-kennel
 * guard and the run reports FAILED (the OK rows still commit; re-running after
 * the seed converges, since the merge dedupes by fingerprint).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-nych3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nych3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseRows } from "@/adapters/html-scraper/hashnyc";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "HashNYC Website";
const KENNEL_TIMEZONE = "America/New_York";
const BASE_URL = "https://hashnyc.com";
const ARCHIVE_URL = `${BASE_URL}/?days=all&backwards=true`;
const MIN_YEAR = 1990; // archive goes back to ~1998; floor well below that

async function fetchEvents(): Promise<RawEventData[]> {
  const res = await safeFetch(ARCHIVE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!res.ok) {
    throw new Error(`Archive fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  // The archive table carries BOTH classes: class="future_hashes past_hashes".
  const rows = $("table.past_hashes tr");
  if (rows.length === 0) {
    throw new Error("No archive rows found — page structure may have changed.");
  }
  const { events, errors } = parseRows($, rows, BASE_URL, false, "past_hashes", MIN_YEAR);
  if (errors.length > 0) {
    console.warn(`  ${errors.length} row parse warnings (first 3): ${errors.slice(0, 3).join(" | ")}`);
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking hashnyc.com receding-hareline archive (?days=all&backwards=true)",
  fetchEvents,
}).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("FAILED:", message);
  // Set exitCode (not process.exit) so the event loop drains and the runner's
  // `finally { await prisma.$disconnect() }` resolves before the process ends.
  process.exitCode = 1;
});
