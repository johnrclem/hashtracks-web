/**
 * One-shot historical backfill for two SFH3 MultiHash kennels whose deep run
 * archives sit on sfh3.com but never reach HashTracks from the recurring scrape:
 *
 *   - SFFMH3 (Fully Mooned H3, kennels=7) — ~100 full-moon crawls 2008→2026 (#2296)
 *   - SVH3   (Silicon Valley H3, kennels=5) — ~1,000+ numbered runs 2002→2026 (#2366)
 *
 * The live SFH3Adapter scrapes `?kennels=all` (the current hareline window only),
 * so the back-catalogue is invisible. The same MultiHash platform exposes a
 * per-kennel year archive at `?kennels=<id>&period=<year>`:
 *   - For SFFMH3 the `period` param is ignored — one fetch returns the whole list.
 *   - For SVH3 each `period` value returns a ~100-row era bucket, so we sweep every
 *     period option (1990-2001 … 2026) and dedupe by (date,run#,title).
 *
 * Rows are parsed with the adapter's OWN exported helpers (`parseHarelineRows`,
 * `parseSFH3Date`, `parseICalSummary`) so the output matches the live scrape;
 * only the kennelTag is forced (the archive view is already filtered to one
 * kennel, and its `td.kennel` carries the display name, not the code).
 *
 * Safe + re-runnable: the source carries `config.upcomingOnly`, so reconcile
 * never cancels these past rows; `processRawEvents` dedupes by fingerprint.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-sfh3-archive-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-sfh3-archive-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseHarelineRows, parseSFH3Date } from "@/adapters/html-scraper/sfh3";
import { parseICalSummary } from "@/adapters/ical/adapter";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "SFH3 MultiHash HTML Hareline";
const KENNEL_TIMEZONE = "America/Los_Angeles";
const BASE = "https://www.sfh3.com/runs";

// MultiHash kennel ids (from the ?kennels=<id> selector on sfh3.com/runs).
const SFFMH3_ID = 7;
const SVH3_ID = 5;
// SVH3 period buckets (the year selector values). Each returns ~100 rows of that
// era; sweeping all + dedup assembles the full archive.
const SVH3_PERIODS = [
  "1990-2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009",
  "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019",
  "2020", "2021", "2022", "2023", "2024", "2025", "2026",
];

async function fetchArchive(kennelId: number, period?: string): Promise<string> {
  const url = period
    ? `${BASE}?kennels=${kennelId}&period=${encodeURIComponent(period)}`
    : `${BASE}?kennels=${kennelId}`;
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`SFH3 archive ${url} → HTTP ${res.status}`);
  return res.text();
}

/** Parse one archive HTML page into RawEventData for the forced kennelTag. */
function parsePage(html: string, kennelTag: string, sourceUrl: string): RawEventData[] {
  const out: RawEventData[] = [];
  for (const row of parseHarelineRows(html)) {
    const date = parseSFH3Date(row.dateText);
    if (!date) continue; // archive header / malformed row
    const parsed = parseICalSummary(row.title);
    out.push({
      date,
      kennelTags: [kennelTag],
      runNumber: row.runNumber ?? parsed.runNumber,
      // parsed.title strips any "KENNEL #N:" prefix; fall back to the raw cell.
      // Empty → undefined so merge synthesizes the default title.
      title: parsed.title ?? (row.title || undefined),
      hares: row.hare,
      location: row.locationText,
      locationUrl: row.locationUrl,
      sourceUrl: row.detailUrl ? new URL(row.detailUrl, BASE).href : sourceUrl,
    });
  }
  return out;
}

/** Stable identity for cross-period dedup. */
function key(e: RawEventData): string {
  return `${e.kennelTags[0]}|${e.date}|${e.runNumber ?? ""}|${e.title ?? ""}`;
}

async function fetchEvents(): Promise<RawEventData[]> {
  const byKey = new Map<string, RawEventData>();
  const add = (events: RawEventData[]) => {
    for (const e of events) if (!byKey.has(key(e))) byKey.set(key(e), e);
  };

  // SFFMH3 — `period` selects the full list regardless of value, but it MUST be
  // present (a period-less fetch returns a different/empty view). Any year works.
  const fmPeriod = "2026";
  const fmUrl = `${BASE}?kennels=${SFFMH3_ID}&period=${fmPeriod}`;
  add(parsePage(await fetchArchive(SFFMH3_ID, fmPeriod), "sffmh3", fmUrl));
  console.log(`  SFFMH3: ${byKey.size} rows`);

  // SVH3 — sweep every period bucket, dedup.
  const before = byKey.size;
  for (const period of SVH3_PERIODS) {
    const svUrl = `${BASE}?kennels=${SVH3_ID}&period=${period}`;
    add(parsePage(await fetchArchive(SVH3_ID, period), "svh3", svUrl));
  }
  console.log(`  SVH3: ${byKey.size - before} rows across ${SVH3_PERIODS.length} period buckets`);

  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking SFH3 MultiHash year-archive for SFFMH3 + SVH3",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
