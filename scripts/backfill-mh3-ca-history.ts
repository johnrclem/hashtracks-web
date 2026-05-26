/**
 * One-shot backfill of MH3 Montreal historical runs (#1661).
 *
 * Walks https://mhhh.ca/trash/{YEAR}/index.html for years 1996-2008 (the only
 * years that respond 200 — the kennel stopped publishing per-run trash
 * archives after 2008 even though they still run weekly). For each year-index
 * row we extract the run number, location, month, year, and scribe. When
 * the row links to a per-run detail page (`trashNNN.htm`), we fetch the
 * detail page and parse the "Date:" line for day-precision and the "Hares:"
 * line for hare names. Year-index-only rows fall back to month-precision
 * (date = first of month) — the merge pipeline still upserts them and the
 * fingerprint stays stable across re-runs.
 *
 * Honest scope: the run #1688 (May 2026) total implies ~1500 historical
 * trails, but only ~100 are publicly archived in a parseable form. The
 * remaining gap is held only as aggregated stats on hashstats.htm. We
 * surface what's reachable; the rest are documented in the PR body.
 *
 * Partitioning (memory `feedback_historical_backfill`): events are filtered
 * to date < today via the shared `reportAndApplyBackfill` helper before any
 * DB write, so this script can re-run safely alongside the live adapter
 * that owns date >= today.
 *
 * Usage:
 *   npm run tsx scripts/backfill-mh3-ca-history.ts                  # dry-run
 *   BACKFILL_APPLY=1 npm run tsx scripts/backfill-mh3-ca-history.ts # write
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import type { RawEventData } from "@/adapters/types";
import { decodeEntities, MONTHS } from "@/adapters/utils";
import { safeFetch } from "@/adapters/safe-fetch";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "Montreal H3 Website";
const KENNEL_TIMEZONE = "America/Toronto"; // Quebec uses Eastern, same offsets as Toronto
const KENNEL_TAG = "mh3-ca";
const ARCHIVE_BASE = "https://mhhh.ca/trash";
const YEARS = Array.from({ length: 13 }, (_, i) => 1996 + i); // 1996..2008
const FETCH_DELAY_MS = 250;

interface IndexRow {
  runNumber: number;
  location?: string;
  month: number;
  year: number;
  scribe?: string;
  detailPath?: string; // e.g. "trash646.htm"
}

async function fetchText(url: string): Promise<string | null> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 hashtracks-backfill" },
  });
  if (!res.ok) return null;
  return res.text();
}

/** Parse one row of the year-index table. */
export function parseIndexRow(
  rowHtml: string,
  fallbackYear: number,
): IndexRow | null {
  const $ = cheerio.load(`<table>${rowHtml}</table>`);
  const text = decodeEntities($("tr").text()).replace(/\s+/g, " ").trim();
  // "Run #204 / Ile-Perrot October 2000 Kristal Tits"
  // "Run #194 - Karaoke Hash / South Shore August 2000 Numbskull"
  // Some legacy rows omit the leading "Run #": skip those.
  const runMatch = /Run\s*#?\s*(\d+)\b/i.exec(text);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  // Find Month Year token; restrict to known month names to avoid false hits.
  const monthMatch = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/.exec(text);
  if (!monthMatch) return null;
  const month = MONTHS[monthMatch[1].toLowerCase()];
  const year = Number.parseInt(monthMatch[2], 10);
  if (year !== fallbackYear) {
    // Cross-year row in a year-index page is suspicious; bail rather than guess.
    return null;
  }

  // Location: between "/ " (after run #) and the month token.
  const afterRunIdx = text.indexOf(runMatch[0]) + runMatch[0].length;
  const monthIdx = text.indexOf(monthMatch[0], afterRunIdx);
  const between = text.slice(afterRunIdx, monthIdx).trim();
  let location: string | undefined;
  const slashIdx = between.indexOf("/");
  if (slashIdx >= 0) {
    location = between.slice(slashIdx + 1).trim() || undefined;
  }

  // Scribe: trailing token after the month-year.
  const scribePart = text.slice(monthIdx + monthMatch[0].length).trim();
  const scribe = scribePart.length > 0 && scribePart.length < 40 ? scribePart : undefined;

  // Detail page link.
  const detailLink = $("a[href$='.htm']").first().attr("href");
  const detailPath = detailLink && /^trash\d+\.htm$/i.test(detailLink) ? detailLink : undefined;

  return { runNumber, location, month, year, scribe, detailPath };
}

/** Extract per-run rows from a year-index page. */
export function parseYearIndex(html: string, year: number): IndexRow[] {
  const $ = cheerio.load(html);
  const rows: IndexRow[] = [];
  $("tr").each((_, tr) => {
    const html = $.html(tr);
    if (!/Run\s*#/i.test(html)) return;
    const parsed = parseIndexRow(html, year);
    if (parsed) rows.push(parsed);
  });
  return rows;
}

/** Parse a detail page to upgrade date precision and pick up hares. */
export function parseDetailPage(html: string): {
  day?: number;
  month?: number;
  year?: number;
  hares?: string;
  startTime?: string;
  scribe?: string;
} {
  const $ = cheerio.load(html);
  const text = decodeEntities($("body").text()).replace(/\s+/g, " ").trim();

  const out: { day?: number; month?: number; year?: number; hares?: string; startTime?: string; scribe?: string } = {};

  // "Date: Sunday, July 6th, 2008 @ 1:00PM"
  const dateMatch = /Date:\s*(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s*([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(text);
  if (dateMatch) {
    const monthName = dateMatch[1];
    out.month = MONTHS[monthName.toLowerCase()];
    out.day = Number.parseInt(dateMatch[2], 10);
    out.year = Number.parseInt(dateMatch[3], 10);
    if (dateMatch[4] && dateMatch[5] && dateMatch[6]) {
      let hours = Number.parseInt(dateMatch[4], 10);
      const minutes = dateMatch[5];
      const ampm = dateMatch[6].toUpperCase();
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
      out.startTime = `${String(hours).padStart(2, "0")}:${minutes}`;
    }
  }

  // "Hares: Yogi, Little Big Man, Anon"
  const haresMatch = /Hares?:\s*([^\n]+?)(?:\(|Location:|Trail|$)/i.exec(text);
  if (haresMatch) {
    const haresRaw = haresMatch[1].replace(/\s+/g, " ").trim();
    if (haresRaw && haresRaw.length < 200) {
      // Sort multi-value joined fields for stable fingerprints (memory).
      const list = haresRaw.split(/\s*,\s*/).filter(Boolean);
      list.sort((a, b) => a.localeCompare(b));
      out.hares = list.join(", ");
    }
  }

  // "written by Clit On"
  const scribeMatch = /written by\s+([A-Z][^\n.(]{1,40})/i.exec(text);
  if (scribeMatch) {
    out.scribe = scribeMatch[1].trim();
  }

  return out;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

async function fetchEvents(): Promise<RawEventData[]> {
  const all: RawEventData[] = [];
  for (const year of YEARS) {
    const indexUrl = `${ARCHIVE_BASE}/${year}/index.html`;
    process.stdout.write(`  ${year}: `);
    const indexHtml = await fetchText(indexUrl);
    if (indexHtml === null) {
      console.log("fetch failed");
      continue;
    }
    const rows = parseYearIndex(indexHtml, year);
    console.log(`${rows.length} rows`);

    for (const row of rows) {
      let day: number | undefined;
      let month = row.month;
      let detailYear = row.year;
      let hares: string | undefined;
      let startTime: string | undefined;
      let scribe = row.scribe;

      if (row.detailPath) {
        await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
        const detailHtml = await fetchText(`${ARCHIVE_BASE}/${year}/${row.detailPath}`);
        if (detailHtml) {
          const parsed = parseDetailPage(detailHtml);
          if (parsed.day && parsed.month && parsed.year) {
            day = parsed.day;
            month = parsed.month;
            detailYear = parsed.year;
          }
          if (parsed.hares) hares = parsed.hares;
          if (parsed.startTime) startTime = parsed.startTime;
          if (parsed.scribe) scribe = parsed.scribe;
        }
      }

      // Same-day merge disambiguation in `src/pipeline/merge.ts`
      // (`sameDayEvents.length > 1`) matches by sourceUrl BEFORE runNumber, so
      // every month-precision row must carry a unique sourceUrl or sibling
      // rows would collapse onto the first. The `#run-NNN` anchor keeps each
      // row provenance-distinct while still pointing back to the archive.
      const date = `${detailYear}-${pad2(month)}-${pad2(day ?? 1)}`;
      const sourceUrl = row.detailPath
        ? `${ARCHIVE_BASE}/${year}/${row.detailPath}`
        : `${indexUrl}#run-${row.runNumber}`;

      const descParts: string[] = [];
      if (scribe) descParts.push(`Trash written by ${scribe}.`);
      if (!day) descParts.push("Day-precision unavailable; date approximated to first of month.");

      all.push({
        date,
        kennelTags: [KENNEL_TAG],
        runNumber: row.runNumber,
        hares,
        location: row.location,
        startTime,
        sourceUrl,
        description: descParts.length > 0 ? descParts.join(" ") : undefined,
      });
    }
  }
  return all;
}

await runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking mhhh.ca/trash archive (${YEARS[0]}-${YEARS.at(-1)})`,
  fetchEvents,
});
