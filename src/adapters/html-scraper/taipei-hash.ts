import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, filterEventsByWindow, normalizeHaresField } from "../utils";

// Taipei Hash House Harriers (台北捷兔) — Taiwan's oldest hash (founded 1973).
// Static Cheerio scrape of the server-rendered PHP hareline at
// taipeihash.com.tw/run_site.php. The page renders three <table.events-table>
// blocks (本週活動 current / 未來預告 future / 歷史足跡 history) plus a parallel
// set of mobile <div.mobile-event-card> duplicates. We parse only the <table>
// rows — the card duplicates use a different DOM shape and are naturally skipped.
//
// Two source-specific quirks drive a bespoke adapter (vs config-only):
//   1. Year-less MM/DD dates over a ~6-month window that includes deep history.
//      A naive today-anchored rollover mis-dates the Jan/Feb history rows a year
//      into the future — instead we anchor on run number (strictly weekly) and
//      resolve each row's year to whatever lands nearest its expected date.
//   2. Hare cells carry a phone number (PII) in a dedicated <span class="phone">.

const KENNEL_TAG = "taipei-h3";
const DEFAULT_URL = "https://www.taipeihash.com.tw/run_site.php";
const START_TIME = "15:00"; // "每星期六下午 3:00 起跑"
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOON_HOUR = 12;

const DATE_RE = /(\d{1,2})\/(\d{1,2})/; // MM/DD — ignores any trailing event tag
const RUN_RE = /(\d+)/;
// Strip a trailing phone number if the dedicated <span class="phone"> was absent
// (markup-drift fallback). Single char class, bounded — ReDoS-safe.
const PHONE_RE = /0\d[\d\s-]{6,15}/g;
// The site uses maps.app.goo.gl shortlinks today (27/27); the extra formats are
// cheap forward-resilience against a future markup change.
const MAPS_HREF =
  "a[href*='maps.app.goo.gl'], a[href*='goo.gl/maps'], a[href*='google.com/maps']";
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);

/** A parsed table row before its year-less date has been resolved. */
interface ParsedRow {
  runNumber: number;
  month: number;
  day: number;
  partial: Omit<RawEventData, "date">;
}

/** Collapse <br> to spaces and return trimmed text of a cell. */
function cellText($cell: Cheerio<Element>): string {
  const clone = $cell.clone();
  clone.find("br").replaceWith(" ");
  return clone.text().replace(/\s+/g, " ").trim();
}

/** First run number in the cell, ignoring NEW / 預告 badges. */
function parseRunNumber(runCell: Cheerio<Element>): number | null {
  const strong = runCell.find("strong").first();
  const text = strong.length > 0 ? strong.text() : runCell.text();
  const match = RUN_RE.exec(text);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}

/** Month/day from the date cell; trailing event tags (特跑/生日/…) are ignored. */
function parseMonthDay(dateCell: Cheerio<Element>): { month: number; day: number } | null {
  const strong = dateCell.find("strong").first();
  const text = strong.length > 0 ? strong.text() : dateCell.text();
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** Hare name(s) with the PII phone number stripped. */
function parseHares(hareCell: Cheerio<Element>): string | undefined {
  const clone = hareCell.clone();
  clone.find(".phone").remove();
  clone.find("br").replaceWith(" ");
  const text = clone.text().replace(PHONE_RE, "").replace(/\s+/g, " ").trim();
  return normalizeHaresField(text);
}

/**
 * Google Maps shortlink from the 記號起點 cell, stored verbatim (no coords).
 * Validates scheme (https) + host against an allowlist so a malformed/hostile
 * href that merely *contains* a Maps substring can't be persisted + rendered.
 */
function parseMapsUrl(marksCell: Cheerio<Element>): string | undefined {
  const href = marksCell.find(MAPS_HREF).first().attr("href")?.trim();
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "https:") return undefined;
    return MAPS_HOSTS.has(parsed.hostname.toLowerCase()) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Round-trip-validated UTC-noon ms for a given year, or null if impossible. */
function utcNoonMs(year: number, month: number, day: number): number | null {
  const ms = Date.UTC(year, month - 1, day, NOON_HOUR, 0, 0);
  const d = new Date(ms);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ms;
}

/** Pick the year (around `targetMs`) whose MM/DD lands closest to it. */
function resolveDate(
  month: number,
  day: number,
  targetMs: number,
): { year: number; ms: number } | null {
  const guessYear = new Date(targetMs).getUTCFullYear();
  let best: { year: number; ms: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const year of [guessYear - 1, guessYear, guessYear + 1]) {
    const ms = utcNoonMs(year, month, day);
    if (ms === null) continue;
    const dist = Math.abs(ms - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = { year, ms };
    }
  }
  return best;
}

/** Parse every <table> data row (header / spacer rows return null and are skipped). */
function parseRows(
  $: CheerioAPI,
  sourceUrl: string,
  errors: string[],
  parseErrors: ParseError[],
): ParsedRow[] {
  const rows: ParsedRow[] = [];
  $("table.events-table tbody tr").each((i, tr) => {
    try {
      const tds = $(tr).children("td");
      if (tds.length < 5) return; // header / spacer row
      const runNumber = parseRunNumber(tds.eq(0));
      const md = parseMonthDay(tds.eq(1));
      if (runNumber === null || md === null) {
        // A 5-cell row that can't yield a run number + MM/DD is a real anomaly
        // (header/spacer rows were already filtered by the <5 cell guard) —
        // surface it so partial markup drift doesn't undercount silently.
        const message = `Unparseable row ${i}: missing run number or date`;
        errors.push(message);
        parseErrors.push({
          row: i,
          section: "run_site",
          error: message,
          rawText: $(tr).text().trim().slice(0, 2000),
        });
        return;
      }
      rows.push({
        runNumber,
        month: md.month,
        day: md.day,
        partial: {
          kennelTags: [KENNEL_TAG],
          runNumber,
          startTime: START_TIME,
          hares: parseHares(tds.eq(2)),
          location: cellText(tds.eq(3)) || undefined,
          locationUrl: parseMapsUrl(tds.eq(4)),
          sourceUrl,
        },
      });
    } catch (err) {
      errors.push(`Error parsing row ${i}: ${err}`);
      parseErrors.push({
        row: i,
        section: "run_site",
        error: String(err),
        rawText: $(tr).text().trim().slice(0, 2000),
      });
    }
  });
  return rows;
}

/**
 * Anchor on the row nearest *today* (a strictly-weekly kennel makes this the
 * current run), then expect every other row at `anchorDate + (runNumber −
 * anchorRun) × 7 days` and pick the year whose MM/DD lands closest to it.
 */
function pickAnchor(rows: ParsedRow[], refMs: number): { run: number; ms: number } | null {
  let anchor: { run: number; ms: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const resolved = resolveDate(row.month, row.day, refMs);
    if (resolved === null) continue;
    const dist = Math.abs(resolved.ms - refMs);
    if (dist < bestDist) {
      bestDist = dist;
      anchor = { run: row.runNumber, ms: resolved.ms };
    }
  }
  return anchor;
}

/** Resolve year-less dates, build final events, and dedupe by run number. */
function buildEvents(rows: ParsedRow[], refDate: Date): RawEventData[] {
  const anchor = pickAnchor(rows, refDate.getTime());
  if (anchor === null) return [];

  const byRun = new Map<number, RawEventData>();
  for (const row of rows) {
    const expectedMs = anchor.ms + (row.runNumber - anchor.run) * WEEK_MS;
    const resolved = resolveDate(row.month, row.day, expectedMs);
    if (resolved === null) continue;
    const date = `${resolved.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`;
    byRun.set(row.runNumber, { ...row.partial, date });
  }
  return [...byRun.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Parse the full page into deduped, date-resolved events. */
export function parseTaipeiHash(
  $: CheerioAPI,
  sourceUrl: string,
  refDate: Date,
): { events: RawEventData[]; rowsFound: number; errors: string[]; parseErrors: ParseError[] } {
  const errors: string[] = [];
  const parseErrors: ParseError[] = [];
  const rows = parseRows($, sourceUrl, errors, parseErrors);
  const events = buildEvents(rows, refDate);
  return { events, rowsFound: rows.length, errors, parseErrors };
}

export class TaipeiHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const refDate = new Date();

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { events, rowsFound, errors, parseErrors } = parseTaipeiHash(page.$, url, refDate);

    const errorDetails: ErrorDetails = {};
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    // Fail loud: a clean fetch that yields zero events is almost certainly a
    // markup drift, not an empty hareline. A brand-new source has a 0 baseline,
    // so the zero-event health alert won't catch it — push an error so the
    // reconciler doesn't treat the empty result as "all runs cancelled".
    if (events.length === 0) {
      const message = `Taipei Hash: parsed 0 events from ${rowsFound} rows at ${url} (markup drift?)`;
      errors.push(message);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row: -1, section: "run_site", error: message },
      ];
    }

    const windowed = filterEventsByWindow(events, options?.days ?? 365);

    return {
      events: windowed,
      errors,
      structureHash: page.structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: { rowsFound, eventsParsed: windowed.length },
    };
  }
}
