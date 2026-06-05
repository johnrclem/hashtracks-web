/**
 * Vindobona H3 + Vienna FMH3 (Vienna, Austria) HTML Scraper
 *
 * Scrapes viennahash.org — Vienna's original hash (est. 25 Apr 1982). One source
 * feeds TWO kennels off a single forward hareline, routed by the run-label prefix:
 *   - `Hash #NNNN` → vindobona-h3 (the weekly hash)
 *   - `FMH #NN`    → vienna-fmh3  (the Full Moon sub-chapter)
 *
 * Two static pages:
 *   - plans/futureruns.html → the forward hareline backbone. A flat
 *     `<table id="futuretable">` with columns Date | Hash# | Hares | Comments.
 *     Dates are already ISO `YYYY-MM-DD` (no year inference needed). Run labels
 *     carry trailing `?`/`??` when the kennel hasn't finalized a number
 *     (`FMH #30?`, `Hash #23??`) — those rows still emit a dated event but with
 *     `runNumber` undefined (merge synthesizes the title).
 *   - schedule.html → the single confirmed next run, the only page carrying a
 *     start time, a full venue, and a GPS pin (in `N<lat>, E<lng>` form, NOT a
 *     Maps URL). Merged into the matching futureruns run by run number.
 *
 * Apex host only — www.viennahash.org returns an empty body. Every other run
 * falls back to the Vienna region centroid (no per-row coords on futureruns).
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
import { fetchHTMLPage, buildDateWindow, extractHashRunNumber } from "../utils";
import { isValidCoords } from "@/lib/geo";

const PRIMARY_KENNEL = "vindobona-h3";
const FMH_KENNEL = "vienna-fmh3";
const DEFAULT_HARELINE_URL = "https://viennahash.org/plans/futureruns.html";
const DEFAULT_SCHEDULE_URL = "https://viennahash.org/schedule.html";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const RUN_NO_RE = /^#\d+$/;
/** GPS pin form on schedule.html: "GPS coordinates: N48.21903, E16.37094". */
const GPS_RE = /N(\d+\.\d+),\s*E(\d+\.\d+)/;

/** Collapse internal whitespace; map empty/whitespace-only to undefined. */
function cleanText(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Route a run label to its kennel by prefix; null for header/decorative rows. */
function routeKennel(label: string): string | null {
  const upper = label.toUpperCase();
  if (upper.startsWith("FMH")) return FMH_KENNEL;
  if (upper.startsWith("HASH")) return PRIMARY_KENNEL;
  return null;
}

/** Extract a row's `<td>` text (br→space), mirroring the bangkok/dublin pattern. */
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

/**
 * Parse one futureruns row: Date(ISO) | Hash#/FMH# | Hares | Comments. Returns
 * null for header (`<th>`) and decorative rows. Exported for unit testing.
 */
export function parseFutureRow(cells: string[]): RawEventData | null {
  if (cells.length < 2) return null;

  const date = cells[0]?.trim() ?? "";
  if (!ISO_DATE_RE.test(date)) return null;

  const label = cells[1]?.trim() ?? "";
  const kennelTag = routeKennel(label);
  if (!kennelTag) return null;

  // extractHashRunNumber rejects trailing-`?` tokens (#30?, #23??) → undefined,
  // so the dated event still emits and merge synthesizes "<Kennel> Trail #N".
  return {
    date,
    kennelTags: [kennelTag],
    runNumber: extractHashRunNumber(label),
    hares: cleanText(cells[2]),
    // The Comments column is a free-form note (run type / theme / sometimes a
    // town). It is NOT a reliable venue, so it feeds description, never location.
    description: cleanText(cells[3]),
  };
}

export interface NextRunInfo {
  runNumber: number;
  startTime?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  locationUrl?: string;
}

/** Strip the GPS suffix and a trailing "(or nearby)" qualifier from a venue cell. */
function cleanVenue(locationCell: string): string | undefined {
  const beforeGps = locationCell.split(/GPS coordinates/i)[0] ?? "";
  const venue = beforeGps
    .replace(/\s+/g, " ")
    .replace(/\(or nearby\)\s*$/i, "")
    .trim();
  return venue.length > 0 ? venue : undefined;
}

/**
 * Parse schedule.html's single next-run detail row. The page has several tables
 * (e.g. a "Hash Taxi" contact table); the run row is the only one carrying a
 * `#NNNN` run-number cell alongside an ISO date and an `HH:MM` time, so we match
 * on content shape rather than a brittle table index. Exported for testing.
 */
export function parseScheduleNextRun($: CheerioAPI): NextRunInfo | null {
  let result: NextRunInfo | null = null;

  $("tr").each((_i, el) => {
    if (result) return;
    const cells = extractCells($, el);
    const runCell = cells.find((c) => RUN_NO_RE.test(c.trim()));
    const dateCell = cells.find((c) => ISO_DATE_RE.test(c.trim()));
    const timeCell = cells.find((c) => TIME_RE.test(c.trim()));
    if (!runCell || !dateCell) return;

    const runNumber = extractHashRunNumber(runCell);
    if (runNumber === undefined) return;

    const gpsCell = cells.find((c) => GPS_RE.test(c)) ?? cells[cells.length - 1] ?? "";
    const gps = GPS_RE.exec(gpsCell);

    const info: NextRunInfo = { runNumber };
    if (timeCell) info.startTime = timeCell.trim();
    const venue = cleanVenue(gpsCell);
    if (venue) info.location = venue;
    if (gps) {
      // Range-validate like every other coord path (geo.ts) so a malformed pin
      // (e.g. a dropped decimal → N4821903) can't write a nonsense lat/lng.
      const lat = Number.parseFloat(gps[1]);
      const lng = Number.parseFloat(gps[2]);
      if (isValidCoords(lat, lng)) {
        info.latitude = lat;
        info.longitude = lng;
      }
    }
    const mapsHref = $('a[href*="google.com/maps"]').first().attr("href");
    if (mapsHref) info.locationUrl = mapsHref;

    result = info;
  });

  return result;
}

/** Attach the schedule.html next-run detail to its matching run (by run number). */
function applyNextRun(events: RawEventData[], nextRun: NextRunInfo | null): void {
  if (!nextRun) return;
  const matches = events.filter((e) => e.runNumber === nextRun.runNumber);
  // Only enrich when the match is unambiguous (run numbers are unique per kennel,
  // but a cross-kennel numeric collision would make attribution ambiguous).
  if (matches.length !== 1) return;
  const target = matches[0];
  if (nextRun.startTime) target.startTime = nextRun.startTime;
  if (nextRun.location) target.location = nextRun.location;
  if (nextRun.latitude !== undefined) target.latitude = nextRun.latitude;
  if (nextRun.longitude !== undefined) target.longitude = nextRun.longitude;
  if (nextRun.locationUrl) target.locationUrl = nextRun.locationUrl;
}

export class VindobonaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const harelineUrl = source.url || DEFAULT_HARELINE_URL;
    const scheduleUrl =
      (source.config as { scheduleUrl?: string } | null)?.scheduleUrl ??
      DEFAULT_SCHEDULE_URL;
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const parseErrors: ParseError[] = [];
    const fetchErrors: NonNullable<ErrorDetails["fetch"]> = [];
    let structureHash: string | undefined;
    let rowsFound = 0;

    // 1) Forward hareline — the canonical source of truth.
    const harelinePage = await fetchHTMLPage(harelineUrl);
    if (!harelinePage.ok) {
      errors.push(`Failed to fetch ${harelineUrl}`);
      fetchErrors.push({ url: harelineUrl, message: "fetch failed" });
    } else {
      structureHash = harelinePage.structureHash;
      const $ = harelinePage.$;
      const rows = $("table tr");
      rowsFound = rows.length;
      rows.each((i, el) => {
        try {
          const event = parseFutureRow(extractCells($, el));
          if (event) {
            event.sourceUrl = harelineUrl;
            events.push(event);
          }
        } catch (err) {
          errors.push(`Error parsing row ${i} of ${harelineUrl}: ${err}`);
          parseErrors.push({
            row: i,
            section: "hareline",
            error: String(err),
            rawText: $(el).text().trim().slice(0, 2000),
          });
        }
      });
    }

    // 2) Schedule detail page — optional enrichment of the single next run.
    // A failure here must NOT push to `errors` (that would suppress reconcile);
    // the hareline already carries the dated runs.
    try {
      const schedulePage = await fetchHTMLPage(scheduleUrl);
      if (schedulePage.ok) {
        applyNextRun(events, parseScheduleNextRun(schedulePage.$));
      } else {
        console.warn(`[vindobona-h3] schedule enrichment skipped: ${scheduleUrl} fetch failed`);
      }
    } catch (err) {
      console.warn(`[vindobona-h3] schedule enrichment error: ${err}`);
    }

    const windowed = events
      .filter((e) => {
        const d = new Date(`${e.date}T12:00:00Z`);
        return d >= minDate && d <= maxDate;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // Per-kennel fail-loud zero guard. A markup drift that silently breaks the
    // `Hash #` prefix (or the whole table) must NOT let reconcile false-cancel a
    // kennel's future runs — any error here suppresses reconcile (scrape.ts:533).
    // Zero FMH rows is normal (full moons are occasional), so we don't guard it.
    if (harelinePage.ok) {
      const vindobonaCount = windowed.filter((e) =>
        e.kennelTags.includes(PRIMARY_KENNEL),
      ).length;
      if (windowed.length === 0) {
        errors.push("Vindobona H3: parsed 0 events from futureruns.html (markup drift?)");
      } else if (vindobonaCount === 0) {
        errors.push(
          "Vindobona H3: 0 vindobona-h3 events parsed — only sibling rows found (Hash# prefix drift?)",
        );
      }
    }

    const errorDetails: ErrorDetails = {};
    if (fetchErrors.length > 0) errorDetails.fetch = fetchErrors;
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events: windowed,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound,
        eventsParsed: windowed.length,
      },
    };
  }
}
