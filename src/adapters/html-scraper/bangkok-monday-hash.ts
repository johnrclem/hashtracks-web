/**
 * Bangkok Monday Hash House Harriers (bmh3-bkk) HTML Scraper
 *
 * Scrapes bangkokmondayhhh.com — Bangkok's longest-running hash (est. 1982).
 * Two static pages share the same `Run | Date | Hare | Location [| Links]`
 * table shape:
 *   - FutureHares.html  → the forward hareline backbone (far-out runs, mostly TBA)
 *   - the homepage `/`   → a near-term "Run schedule" table (runs WITH locations)
 *                          plus a `#nextrun` block carrying the only Google Maps
 *                          pin + confirmed start time.
 *
 * Date cells are `DD MMM` with NO year (e.g. "8 Jun", "2 Nov AGM"). The year is
 * inferred from a reference date with Dec→Jan rollover. The single next-run pin
 * is attached to its matching run; every other run falls back to the Bangkok
 * region centroid. Titles are left undefined so the merge pipeline synthesizes
 * "Bangkok Monday H3 Trail #N".
 */

import type { CheerioAPI } from "cheerio";
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
import { chronoParseDate, fetchHTMLPage, buildDateWindow } from "../utils";
import { extractCoordsFromMapsUrl } from "@/lib/geo";

const KENNEL_TAG = "bmh3-bkk";
const DEFAULT_HARELINE_URL = "https://bangkokmondayhhh.com/FutureHares.html";
const HOMEPAGE_URL = "https://bangkokmondayhhh.com/";
/** Fixed Monday start (the homepage next-run block confirms 17:30). */
const DEFAULT_START_TIME = "17:30";

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const DATE_RE = /\b(\d{1,2})\s+([A-Za-z]{3,})/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * DAY_MS;
/**
 * Forward bound for year inference. The live forward hareline reaches ~6 months
 * (≈180 days) ahead, so a candidate landing more than ~8 months out must be a
 * stale prior-year run still shown on the homepage (e.g. a Dec run viewed in
 * early Jan) and rolls back a year. A weekly club never schedules >8 months out.
 */
const EIGHT_MONTHS_MS = 240 * DAY_MS;

/** Drop the `AGM` event marker that leaks into date and hare cells. */
function stripAgm(value: string): string {
  return value.replace(/\bAGM\b/gi, " ").replace(/\s+/g, " ").trim();
}

/** Map a `TBA`/empty cell to undefined; strip AGM markers otherwise. */
function cleanCell(value: string | undefined): string | undefined {
  const cleaned = stripAgm(value?.trim() ?? "");
  if (!cleaned || /^tba$/i.test(cleaned)) return undefined;
  return cleaned;
}

function parseMonthDay(
  dateText: string,
): { day: number; monthIndex: number; monthWord: string } | null {
  const m = DATE_RE.exec(stripAgm(dateText));
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const monthWord = m[2];
  const monthIndex = MONTHS[monthWord.slice(0, 3).toLowerCase()];
  if (Number.isNaN(day) || monthIndex === undefined) return null;
  return { day, monthIndex, monthWord };
}

/**
 * Forward-hareline year inference for year-less `DD MMM` cells:
 *  - more than ~60 days in the past → next year (a Jan/Feb row on a mid-year
 *    forward page). The 60-day margin keeps the 1–2 just-completed runs the
 *    homepage still lists in the current year.
 *  - more than ~8 months in the future → prior year (a stale Nov/Dec run still
 *    shown on the homepage when scraped in early Jan/Feb).
 */
export function inferYear(monthIndex: number, day: number, refDate: Date): number {
  const refYear = refDate.getUTCFullYear();
  const diff = Date.UTC(refYear, monthIndex, day, 12, 0, 0) - refDate.getTime();
  if (diff < -SIXTY_DAYS_MS) return refYear + 1;
  if (diff > EIGHT_MONTHS_MS) return refYear - 1;
  return refYear;
}

/** Resolve a forward `DD MMM` cell to `YYYY-MM-DD` (year inferred, Dec→Jan rollover). */
export function parseForwardDate(dateText: string, refDate: Date): string | null {
  const parts = parseMonthDay(dateText);
  if (!parts) return null;
  const year = inferYear(parts.monthIndex, parts.day, refDate);
  return chronoParseDate(`${parts.day} ${parts.monthWord} ${year}`, "en-GB");
}

/** Resolve an archive `DD MMM` cell to `YYYY-MM-DD` using the page's known year. */
export function parseArchiveDate(dateText: string, pageYear: number): string | null {
  const parts = parseMonthDay(dateText);
  if (!parts) return null;
  return chronoParseDate(`${parts.day} ${parts.monthWord} ${pageYear}`, "en-GB");
}

/**
 * Parse a single hareline/archive table row into a RawEventData. Shared by the
 * live adapter (forward date resolver) and the historical backfill (page-year
 * resolver). Returns null for header/nav/decorative rows (no numeric run #).
 * Exported for unit testing and backfill reuse.
 */
export function parseHarelineRow(
  cells: string[],
  resolveDate: (dateText: string) => string | null,
): RawEventData | null {
  // Columns: [0]=run #, [1]=date, [2]=hare, [3]=location, [4]=links (optional)
  if (cells.length < 4) return null;

  const runNumber = Number.parseInt(cells[0]?.trim() ?? "", 10);
  if (Number.isNaN(runNumber)) return null;

  const dateText = cells[1]?.trim() ?? "";
  if (!dateText) return null;
  const date = resolveDate(dateText);
  if (!date) return null;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares: cleanCell(cells[2]),
    location: cleanCell(cells[3]),
    startTime: DEFAULT_START_TIME,
  };
}

export interface NextRunInfo {
  runNumber: number;
  locationUrl?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Parse the homepage `#nextrun` block: the run number plus the single Google
 * Maps pin (the only coordinates anywhere on the site). Exported for testing.
 */
export function parseNextRunBlock($: CheerioAPI): NextRunInfo | null {
  const block = $("#nextrun");
  if (block.length === 0) return null;

  const runMatch = /Run\s*No\.?\s*(\d{2,5})/i.exec(block.text());
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  let locationUrl: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;
  block.find("a").each((_i, a) => {
    if (latitude !== undefined) return;
    const href = $(a).attr("href");
    if (!href) return;
    const coords = extractCoordsFromMapsUrl(href);
    if (coords) {
      locationUrl = href;
      latitude = coords.lat;
      longitude = coords.lng;
    }
  });

  return { runNumber, locationUrl, latitude, longitude };
}

/** Keep the more-complete of two rows for the same run (prefer one with a location). */
function upsertEvent(map: Map<number, RawEventData>, event: RawEventData): void {
  const runNumber = event.runNumber;
  if (typeof runNumber !== "number") return;
  const existing = map.get(runNumber);
  if (!existing) {
    map.set(runNumber, event);
    return;
  }
  if (!existing.location && event.location) map.set(runNumber, event);
}

/** Extract a row's `<td>` text (br→space), mirroring the dublin pattern. */
function extractCells($: CheerioAPI, el: Element): string[] {
  const cells: string[] = [];
  $(el)
    .find("td")
    .each((_j, td) => {
      const $td = $(td);
      $td.find("br").replaceWith(" ");
      cells.push($td.text().trim());
    });
  return cells;
}

interface PageCollector {
  target: Map<number, RawEventData>;
  errors: string[];
  parseErrors: ParseError[];
}

/** Parse every table row on one page into `collector`; returns the row count. */
function collectPageRows(
  $: CheerioAPI,
  url: string,
  refDate: Date,
  collector: PageCollector,
): number {
  const rows = $("table tr");
  rows.each((i, el) => {
    try {
      const event = parseHarelineRow(extractCells($, el), (t) =>
        parseForwardDate(t, refDate),
      );
      if (event) {
        event.sourceUrl = url;
        upsertEvent(collector.target, event);
      }
    } catch (err) {
      collector.errors.push(`Error parsing row ${i} of ${url}: ${err}`);
      collector.parseErrors.push({
        row: i,
        section: "hareline",
        error: String(err),
        rawText: $(el).text().trim().slice(0, 2000),
      });
    }
  });
  return rows.length;
}

/** Attach the single homepage next-run pin to its matching run, if present. */
function applyNextRun(
  map: Map<number, RawEventData>,
  nextRun: NextRunInfo | null,
): void {
  if (!nextRun) return;
  const target = map.get(nextRun.runNumber);
  if (!target) return;
  if (nextRun.locationUrl) target.locationUrl = nextRun.locationUrl;
  if (nextRun.latitude !== undefined) target.latitude = nextRun.latitude;
  if (nextRun.longitude !== undefined) target.longitude = nextRun.longitude;
}

export class BangkokMondayHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const harelineUrl = source.url || DEFAULT_HARELINE_URL;
    const refDate = new Date();
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    const eventsByRun = new Map<number, RawEventData>();
    const errors: string[] = [];
    const parseErrors: ParseError[] = [];
    const fetchErrors: NonNullable<ErrorDetails["fetch"]> = [];
    let structureHash: string | undefined;
    let nextRun: NextRunInfo | null = null;
    let rowsFound = 0;

    // Hareline first (canonical structure hash); homepage second (near-term
    // rows with locations + the next-run pin).
    for (const url of [harelineUrl, HOMEPAGE_URL]) {
      const page = await fetchHTMLPage(url);
      if (!page.ok) {
        errors.push(`Failed to fetch ${url}`);
        fetchErrors.push({ url, message: "fetch failed" });
        continue;
      }
      if (url === harelineUrl) structureHash = page.structureHash;
      if (url === HOMEPAGE_URL) nextRun = parseNextRunBlock(page.$);
      rowsFound += collectPageRows(page.$, url, refDate, {
        target: eventsByRun,
        errors,
        parseErrors,
      });
    }

    applyNextRun(eventsByRun, nextRun);

    const errorDetails: ErrorDetails = {};
    if (fetchErrors.length > 0) errorDetails.fetch = fetchErrors;
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    const events = [...eventsByRun.values()]
      .filter((e) => {
        const d = new Date(`${e.date}T12:00:00Z`);
        return d >= minDate && d <= maxDate;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound,
        eventsParsed: events.length,
      },
    };
  }
}
