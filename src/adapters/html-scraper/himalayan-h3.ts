/**
 * Himalayan Hash House Harriers (himalayan-h3) HTML Scraper
 *
 * Scrapes himalayanhash.run — Kathmandu's "Nepal's only hash" (est. 1979), and
 * HashTracks' first Nepal kennel. The WordPress 6.5.8 home page is server-
 * rendered (static Cheerio, no browser render) and carries a single TablePress
 * "Receding Hareline" table:
 *
 *   Hash# | Date | Time | On-In | Hares | What3Words
 *   Run 2521 | 13th June | 1500 Hrs | Chobhar / Adinath School | Call Boy | <w3w link>
 *
 * Date cells are `Dth Month` with NO year — inferred forward from today (Dec→Jan
 * rollover). The table is a rolling window (current + next ~2 runs, mostly
 * placeholders), so the source is `upcomingOnly`. Rows are gated to a tight
 * near-term horizon (see `isWithinHareHorizon`) so an abandoned/frozen table
 * fails closed (zero events → loud error) instead of republishing last year's
 * runs as phantom future events when the calendar wraps back to their month.
 *
 * Below the table a single featured-run detail block (`HASH NNNN` heading) carries
 * a Google Maps button (`maps.app.goo.gl`) plus a Fusion-map shortcode with the
 * venue's real decimal coordinates. Both are merged onto the matching run by run
 * number (mirrors bangkok-monday-hash's next-run pin merge).
 *
 * The source has no per-row title (only "Run NNNN"), so `title` is left undefined
 * and merge.ts synthesizes "Himalayan H3 Trail #N".
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import { fetchHTMLPage, filterEventsByWindow, MONTHS_ZERO, stripPlaceholder } from "../utils";

const KENNEL_TAG = "himalayan-h3";
const DEFAULT_URL = "https://himalayanhash.run/";

// "Run 2521" → 2521 (NOT extractHashRunNumber — the source uses no `#`).
const RUN_RE = /\bRun\s+(\d+)\b/i;
// "1500 Hrs" → 15:00. `\s*` sits beside a literal "Hrs", not an alternation, so
// no S5852 backtracking shape.
const TIME_RE = /\b(\d{1,2})(\d{2})\s*Hrs\b/i;
// Strip an ordinal suffix from a day number ("13th" → "13").
const ORDINAL_RE = /(\d)(?:st|nd|rd|th)\b/gi;
// Day-of-month token in a date cell.
const DAY_RE = /\b(\d{1,2})\b/;
// Candidate alphabetic month words (no month-name alternation → no S5843
// complexity bump); each candidate is validated by exact MONTH_INDEX lookup.
const MONTH_WORD_RE = /\b[a-z]{3,9}\b/gi;
// "HASH 2521" featured-run heading (the detail block's run number).
const DETAIL_RUN_RE = /^HASH\s+(\d+)$/i;
// Fusion-map shortcode coordinates, e.g.
//   "latitude":"27.666559","longitude":" 85.293534"
// (note the leading space inside the longitude quotes). The single `\s*` is
// adjacent to a bounded numeric capture, not an alternation — S5852-safe.
const FUSION_COORDS_RE = /"latitude":"(-?\d+\.\d+)","longitude":"\s*(-?\d+\.\d+)"/;
// "Undecided" venue placeholder — NOT caught by stripPlaceholder's TBD/TBA list.
const UNDECIDED_RE = /^undecided$/i;
// What3Words hosts (the source serves http://w3w.co/<addr>; the validator is
// scheme-agnostic so it accepts the live http link and https alike).
const W3W_HOSTS = new Set(["w3w.co", "what3words.com", "www.what3words.com"]);

// Reuse the canonical 0-indexed month map from utils; wrap it in a Map so the
// computed lookup is `.get()` (no object-key injection — Codacy/Gemini flag
// `Record[var]`). Keyed by full name and abbreviation.
const MONTH_INDEX = new Map<string, number>(Object.entries(MONTHS_ZERO));

const DAY_MS = 24 * 60 * 60 * 1000;
// A "Receding Hareline" only ever lists the current run plus the next few weekly
// ones, so a legitimate row is always within a tight near-term window. We bound
// acceptance accordingly to fail CLOSED on an abandoned/frozen table: a year-less
// row that nobody updates resolves to the SAME month next year, which would
// otherwise land inside the ±90d scrape window and publish as a phantom future
// run that reconcile/health can't catch (valid-looking date, present every
// scrape). Out-of-horizon rows are dropped; when EVERY row is stale the adapter
// emits zero events and fails loud instead (see fetch). The narrow residual — a
// fully-frozen table scraped within ~FUTURE_HORIZON_DAYS of its frozen month —
// is irreducible without a page-freshness signal and is shared by every
// year-less upcomingOnly adapter.
const PAST_GRACE_DAYS = 14;
const FUTURE_HORIZON_DAYS = 42;

/** True if a resolved date falls inside the receding-hareline near-term horizon. */
function isWithinHareHorizon(date: string, now: Date): boolean {
  const diffMs = new Date(`${date}T12:00:00Z`).getTime() - now.getTime();
  return diffMs >= -PAST_GRACE_DAYS * DAY_MS && diffMs <= FUTURE_HORIZON_DAYS * DAY_MS;
}

/** Resolve a year-less month/day to the nearest upcoming "YYYY-MM-DD" (UTC noon). */
function resolveForwardDate(monthIdx: number, day: number, now: Date): string {
  const PAST_GRACE_MS = 60 * 24 * 3600 * 1000;
  const year = now.getUTCFullYear();
  let ms = Date.UTC(year, monthIdx, day, 12, 0, 0);
  if (ms < now.getTime() - PAST_GRACE_MS) {
    ms = Date.UTC(year + 1, monthIdx, day, 12, 0, 0);
  }
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse a year-less "13th June" cell to "YYYY-MM-DD", or null if unparseable. */
export function parseRecedingDate(dateText: string, now: Date): string | null {
  const cleaned = dateText.replaceAll(ORDINAL_RE, "$1");
  let monthIdx: number | undefined;
  for (const m of cleaned.matchAll(MONTH_WORD_RE)) {
    const idx = MONTH_INDEX.get(m[0].toLowerCase());
    if (idx !== undefined) {
      monthIdx = idx;
      break;
    }
  }
  if (monthIdx === undefined) return null;
  const dm = DAY_RE.exec(cleaned);
  if (!dm) return null;
  const day = Number.parseInt(dm[1], 10);
  if (day < 1 || day > 31) return null;
  return resolveForwardDate(monthIdx, day, now);
}

/** Parse "1500 Hrs" → "15:00", or undefined if absent/malformed. */
export function parseRecedingTime(timeText: string): string | undefined {
  const m = TIME_RE.exec(timeText);
  if (!m) return undefined;
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return undefined;
  return `${hour.toString().padStart(2, "0")}:${m[2]}`;
}

/** Venue cell text → display location, mapping "Undecided"/TBD placeholders to undefined. */
function cleanVenue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || UNDECIDED_RE.test(trimmed)) return undefined;
  return stripPlaceholder(trimmed);
}

/** A What3Words href if it points at a w3w/what3words host, else undefined. */
export function extractW3wUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    return W3W_HOSTS.has(parsed.hostname.toLowerCase()) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Cell text with `<br>` rendered as " / " (joins the area + venue lines). */
function venueCellText($: CheerioAPI, td: Element): string {
  const $td = $(td).clone();
  $td.find("br").replaceWith(" / ");
  return $td.text().replaceAll(/\s+/g, " ").trim();
}

/** Parse one TablePress data row into a RawEventData, or null for non-run rows. */
export function parseHarelineRow(
  $: CheerioAPI,
  row: Element,
  now: Date,
): RawEventData | null {
  const $tds = $(row).find("td");
  if ($tds.length < 6) return null;

  const runMatch = RUN_RE.exec($tds.eq(0).text().trim());
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  const date = parseRecedingDate($tds.eq(1).text().trim(), now);
  // Drop unparseable rows AND stale rows outside the near-term horizon (a frozen
  // year-less row resolves to next year's same month — fail closed, don't
  // publish a phantom future run).
  if (!date || !isWithinHareHorizon(date, now)) return null;

  const startTime = parseRecedingTime($tds.eq(2).text().trim());
  const location = cleanVenue(venueCellText($, $tds.eq(3).get(0) as Element));
  // Placeholder hares ("Needed"/"TBA"/blank) → explicit null clear (#2032
  // tri-state) so a later real hare or a clear propagates; a real name stays.
  const hares = stripPlaceholder($tds.eq(4).text()) ?? null;
  const locationUrl = extractW3wUrl($tds.eq(5).find("a").first().attr("href"));

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // title left undefined → merge synthesizes "Himalayan H3 Trail #N".
    hares,
    location,
    locationUrl,
    startTime,
  };
}

interface DetailBlock {
  runNumber?: number;
  locationUrl?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Parse the single featured-run detail block below the table: its `HASH NNNN`
 * run number, the Google Maps button, and the Fusion-map venue coordinates.
 * Exported for testing.
 */
export function parseDetailBlock($: CheerioAPI, html: string): DetailBlock {
  const block: DetailBlock = {};

  // og:description (a <meta>) also contains "HASH 2521", so scope the run-number
  // search to heading/inline elements only.
  $("h1, h2, h3, h4, h5, span, strong").each((_i, el) => {
    if (block.runNumber !== undefined) return;
    const m = DETAIL_RUN_RE.exec($(el).text().trim());
    if (m) block.runNumber = Number.parseInt(m[1], 10);
  });

  const mapsHref = $('a[href*="maps.app.goo.gl"]').first().attr("href");
  if (mapsHref) block.locationUrl = mapsHref.trim();

  const coords = FUSION_COORDS_RE.exec(html);
  if (coords) {
    const lat = Number.parseFloat(coords[1]);
    const lng = Number.parseFloat(coords[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      block.latitude = lat;
      block.longitude = lng;
    }
  }

  return block;
}

/** Attach the featured-run detail block to its matching run, if present. */
function applyDetailBlock(map: Map<number, RawEventData>, detail: DetailBlock): void {
  if (detail.runNumber === undefined) return;
  const target = map.get(detail.runNumber);
  if (!target) return;
  // Maps link is preferred over the row's w3w fallback.
  if (detail.locationUrl) target.locationUrl = detail.locationUrl;
  if (detail.latitude !== undefined) target.latitude = detail.latitude;
  if (detail.longitude !== undefined) target.longitude = detail.longitude;
}

export interface ParsedPage {
  events: RawEventData[];
  parseErrors: ParseError[];
  rowsFound: number;
}

/**
 * Parse the Himalayan H3 home page into date-sorted events (NOT yet windowed).
 * Pure (no network) so the full table + detail-block merge is unit-testable.
 */
export function parseHimalayanPage(html: string, now: Date, sourceUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  let rows = $("table.tablepress tbody tr");
  if (rows.length === 0) rows = $("table tbody tr");

  const eventsByRun = new Map<number, RawEventData>();
  const parseErrors: ParseError[] = [];

  rows.each((i, el) => {
    try {
      const event = parseHarelineRow($, el, now);
      if (event && typeof event.runNumber === "number") {
        event.sourceUrl = sourceUrl;
        eventsByRun.set(event.runNumber, event);
      }
    } catch (err) {
      parseErrors.push({
        row: i,
        section: "receding_hareline",
        error: String(err),
        rawText: $(el).text().trim().slice(0, 2000),
      });
    }
  });

  applyDetailBlock(eventsByRun, parseDetailBlock($, html));

  const events = [...eventsByRun.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { events, parseErrors, rowsFound: rows.length };
}

export class HimalayanHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { events: parsed, parseErrors, rowsFound } = parseHimalayanPage(
      html,
      new Date(),
      url,
    );
    const events = filterEventsByWindow(parsed, options?.days ?? 90);

    const errors: string[] = parseErrors.map((p) => p.error);

    // Fail-loud: a single SSR surface with a brand-new 0-event baseline can't
    // rely on the zero-event health alert. An empty result — whether markup
    // drift (nothing parsed) or every run falling outside the window — means we
    // have nothing to publish; surface an error so reconcile.ts is suppressed
    // (don't false-CANCEL the sole-source canonicals).
    if (events.length === 0) {
      errors.push(
        `Himalayan H3: no upcoming runs from ${url} ` +
          `(${rowsFound} rows, ${parsed.length} parsed)`,
      );
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      diagnosticContext: {
        rowsFound,
        eventsParsed: events.length,
        totalBeforeFilter: parsed.length,
        fetchDurationMs,
      },
    };
  }
}
