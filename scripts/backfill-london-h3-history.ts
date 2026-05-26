/**
 * One-shot historical backfill for London H3 (LH3) — issue #1607.
 *
 * LH3 currently has ~62 upcoming events from runlist.php (#2820–#2863).
 * The same site exposes /hashtory.php — a 17-year archive (2010 → today)
 * of ~907 completed runs. Per-year URLs `?year=YYYY` carry unambiguous
 * year context via the `<h2>Hash Runs YYYY</h2>` header; the dates in
 * row cells omit the year ("Sun Dec 26th").
 *
 * Bound to the live "London Hash Run List" source — same kennel, same
 * site, sister archive page. Matches the LIL pattern (hashnyc.com hosts
 * both the live source and the historical archive query).
 *
 * Yield estimate: ~887 events (Jan 2010 → today). Re-runnable: the
 * runner partitions to `date < today (Europe/London)` and the merge
 * pipeline short-circuits on existing fingerprints.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-london-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-london-h3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { safeFetch } from "@/adapters/safe-fetch";
import { decodeEntities } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "London Hash Run List";
const BASE_URL = "https://www.londonhash.org";
const KENNEL_TAG = "lh3";
const KENNEL_TIMEZONE = "Europe/London";

/** Archive's earliest available year. Year selector caps at 2010 — runs
 * #1–#1932 (1975 → end of 2009) are not on the website. */
const ARCHIVE_START_YEAR = 2010;
const POLITENESS_DELAY_MS = 250;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a hashtory date cell like "Sun Dec 26th" with explicit year
 * context. Returns YYYY-MM-DD or null. Exported for unit testing.
 *
 * Hand-rolled instead of chrono: the input is rigidly shaped (DOW Month
 * Day-with-ordinal) and chrono's ambiguous-date heuristics are risky
 * when year context lives in a separate variable (cf. memory note
 * `feedback_chrono_forward_date_explicit_year.md`).
 */
export function parseHashtoryDate(cellText: string, year: number): string | null {
  // Strip the day-of-week prefix and trailing ordinal/whitespace.
  // Shape: "(Sun )Dec 26th( )" or "Dec 26th".
  const match = /([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?/.exec(cellText.trim());
  if (!match) return null;
  const monthStr = match[1].slice(0, 3).toLowerCase();
  const day = parseInt(match[2], 10);
  const month = MONTH_NAMES[monthStr];
  if (!month || day < 1 || day > 31) return null;
  // Calendar-validate (rejects Feb 30, etc.)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Sort comma-separated hare names so re-runs produce identical fingerprints.
 * Source row order isn't guaranteed stable across scrapes
 * (per `feedback_fingerprint_stability.md`). Exported for unit testing. */
export function normalizeHares(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Source uses "X and Y" / "X, Y and Z" formats. Normalize on "and" + ","
  // then sort. "Hare required" / placeholder check happens after.
  const tokens = trimmed
    .split(/\s*(?:,|\band\b)\s*/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !/required|volunteer|tba|tbd|tbc/i.test(t));
  if (tokens.length === 0) return undefined;
  return [...tokens].sort((a, b) => a.localeCompare(b, "en")).join(", ");
}

/** Parse one `.hrlistRow` + adjacent `.packHolder` into RawEventData,
 * or null when the row doesn't carry a usable date + run number.
 *
 * Exported for unit testing. */
export function parseHrlistRow(
  $: cheerio.CheerioAPI,
  row: AnyNode,
  year: number,
): RawEventData | null {
  const $row = $(row);

  // Run number — text of the anchor in .htRunNo.
  const $runAnchor = $row.find(".htRunNo a").first();
  const runText = $runAnchor.text().trim();
  const runNumber = parseInt(runText, 10);
  if (!runNumber || runNumber <= 0) return null;

  // Date — .htDate text, parsed against the year-context.
  const dateCellText = decodeEntities($row.find(".htDate").first().text());
  const date = parseHashtoryDate(dateCellText, year);
  if (!date) return null;

  // Location — .htlocDesc text (verbatim). Includes theme tags like
  // "LH3 50th Anniversary Hash" inline with the pub name — per the
  // issue body, these are legitimate parts of the location string.
  const locationRaw = decodeEntities($row.find(".htlocDesc").first().text()).trim();
  const location = locationRaw || undefined;

  // Hares — .htHare text, deterministically sorted.
  const haresRaw = decodeEntities($row.find(".htHare").first().text());
  const hares = normalizeHares(haresRaw);

  // Pack list — next-sibling .packHolder, if present.
  const $pack = $row.next(".packHolder");
  const packText = $pack.length > 0
    ? decodeEntities($pack.text()).replace(/\s+/g, " ").trim()
    : undefined;
  // Description = pack list verbatim ("The Pack: Name, Name. Total 5.")
  // when present. Useful historical context.
  const description = packText || undefined;

  // sourceUrl: from the .htRunNo anchor href.
  const href = $runAnchor.attr("href")?.trim();
  const sourceUrl = href ? new URL(href, `${BASE_URL}/`).toString() : `${BASE_URL}/hashtory.php`;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // title left undefined — merge pipeline synthesizes "London H3 Trail #N".
    hares,
    location,
    description,
    // startTime intentionally undefined — historical rows have no time
    // data; D14 atomic semantics preserve whatever the live adapter
    // emits rather than asserting "London H3 has always been noon".
    sourceUrl,
  };
}

/** Parse a single hashtory.php?year=YYYY page. Exported for unit testing. */
export function parseHashtoryYear(html: string, year: number): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $(".hrlistRow").each((_i, row) => {
    const event = parseHrlistRow($, row, year);
    if (event) events.push(event);
  });
  return events;
}

async function fetchYear(year: number): Promise<RawEventData[]> {
  const url = `${BASE_URL}/hashtory.php?year=${year}`;
  const response = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  const html = await response.text();
  return parseHashtoryYear(html, year);
}

async function fetchEvents(): Promise<RawEventData[]> {
  const endYear = new Date().getUTCFullYear();
  const events: RawEventData[] = [];
  console.log(`  Walking ${ARCHIVE_START_YEAR}-${endYear} (${endYear - ARCHIVE_START_YEAR + 1} year pages)...`);
  for (let yr = ARCHIVE_START_YEAR; yr <= endYear; yr++) {
    const yearEvents = await fetchYear(yr);
    console.log(`    year=${yr}: ${yearEvents.length} rows`);
    events.push(...yearEvents);
    if (yr < endYear) await sleep(POLITENESS_DELAY_MS);
  }
  return events;
}

if (process.argv[1]?.endsWith("backfill-london-h3-history.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: `Walking londonhash.org/hashtory.php year pages for LH3 archive`,
    fetchEvents,
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAILED:", message);
    process.exit(1);
  });
}
