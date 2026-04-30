/**
 * Bull Moon Hash House Harriers (BMH3) HTML Scraper
 *
 * Scrapes bullmoonh3.co.uk for upcoming and historical runs.
 * The site is Wix-hosted with Table Master cross-origin iframes
 * for event tables — requires browser rendering via NAS Playwright.
 *
 * Two event series from the same kennel:
 *   - Bull Moon (🐂 Run NNN): Monthly Saturday near full moon, 12:00 PM
 *   - T3 (T3 Run NNN): Weekly Thursday, 6:45 PM
 *
 * Two pages:
 *   /upcoming-runs — future events table (Date, Time, Event, Hares, Venue, Station)
 *   /receding-hareline — historical events table (Date, Event, Hares, Venue)
 *
 * Founded February 2016. Birmingham/West Midlands area.
 */
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  MONTHS_ZERO,
  chronoParseDate,
  EMOJI_RE,
  extractUkPostcode,
  googleMapsSearchUrl,
  parse12HourTime,
  stripPlaceholder,
  buildDateWindow,
  fetchBrowserRenderedPage,
} from "../utils";

const KENNEL_CODE = "bullmoon";
const DISPLAY_NAME = "Bull Moon";

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

export interface EventClassification {
  series: "bull-moon" | "t3" | "social" | "special";
  runNumber?: number;
  cleanTitle: string;
}

/**
 * Classify a Bull Moon event from the Event column text.
 * Exported for unit testing.
 */
export function classifyBullMoonEvent(text: string): EventClassification {
  const cleanTitle = text
    .replace(EMOJI_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (/T3\s+Social/i.test(text)) {
    return { series: "social", cleanTitle };
  }

  const t3Match = /T3\s+Run\s+(\d+)/i.exec(text);
  if (t3Match) {
    return { series: "t3", runNumber: parseInt(t3Match[1], 10), cleanTitle };
  }

  const bmMatch = /(?:🐂\s*)?Run\s+(\d+)/i.exec(text);
  if (bmMatch) {
    return { series: "bull-moon", runNumber: parseInt(bmMatch[1], 10), cleanTitle };
  }

  return { series: "special", cleanTitle };
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Bull Moon date string like "Thu, 2 Apr 26" or "Sat, 20 Feb 16".
 * Manual parsing because 2-digit years confuse chrono-node.
 * Exported for unit testing.
 */
export function parseBmDate(text: string): string | null {
  const match = /\w+,?\s+(\d{1,2})\s+(\w+)\s+(\d{2})\b/.exec(text);
  if (!match) return chronoParseDate(text, "en-GB");

  const day = parseInt(match[1], 10);
  const twoDigitYear = parseInt(match[3], 10);
  const year = twoDigitYear < 70 ? 2000 + twoDigitYear : 1900 + twoDigitYear;

  const monthNum = MONTHS_ZERO[match[2].toLowerCase().slice(0, 3)];
  if (monthNum === undefined) return null;

  // Validate day is in range for the month (prevents silent Date.UTC normalization)
  const maxDay = new Date(Date.UTC(year, monthNum + 1, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;

  const date = new Date(Date.UTC(year, monthNum, day, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

const DEFAULT_TIMES: Record<string, string> = {
  "t3": "18:45",
  "social": "18:45",
  "bull-moon": "12:00",
  "special": "12:00",
};

export interface ParsedBullMoonRun {
  date?: string;
  startTime?: string;
  series: EventClassification["series"];
  runNumber?: number;
  title: string;
  hares?: string;
  location?: string;
  locationUrl?: string;
  nearestStation?: string;
}

function parseTime(cells: string[], columnMap: Map<string, number>, series: string): string {
  const timeIdx = columnMap.get("time");
  const timeText = timeIdx !== undefined ? cells[timeIdx]?.trim() : undefined;
  const parsed = timeText && !/tbc|tbd|tba/i.test(timeText)
    ? parse12HourTime(timeText)
    : null;
  return parsed ?? DEFAULT_TIMES[series] ?? "12:00";
}

function parseHares(cells: string[], columnMap: Map<string, number>): string | undefined {
  const idx = columnMap.get("hares");
  if (idx === undefined || !cells[idx]) return undefined;
  return stripPlaceholder(cells[idx].trim()) ?? undefined;
}

function parseVenue(cells: string[], columnMap: Map<string, number>): { location?: string; locationUrl?: string } {
  const idx = columnMap.get("venue");
  if (idx === undefined || !cells[idx]) return {};

  const venueText = cells[idx]
    .replace(EMOJI_RE, "")
    .replace(/\s*within\s+CAZ\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const venue = stripPlaceholder(venueText);
  if (!venue) return {};

  const postcode = extractUkPostcode(venue);
  return {
    location: venue,
    locationUrl: postcode ? googleMapsSearchUrl(postcode) : undefined,
  };
}

function parseStation(cells: string[], columnMap: Map<string, number>): string | undefined {
  const idx = columnMap.get("nearest station");
  if (idx === undefined || !cells[idx]) return undefined;
  const text = cells[idx].trim();
  return text && !/^n\/a$/i.test(text) ? text : undefined;
}

/**
 * Parse a table row from the Bull Moon Table Master widget.
 * Exported for unit testing.
 */
export function parseBullMoonRow(
  cells: string[],
  columnMap: Map<string, number>,
): ParsedBullMoonRun | null {
  const dateIdx = columnMap.get("date");
  const eventIdx = columnMap.get("event");

  if (dateIdx === undefined || eventIdx === undefined) return null;
  if (!cells[dateIdx] || !cells[eventIdx]) return null;

  const date = parseBmDate(cells[dateIdx].trim());
  if (!date) return null;

  const classification = classifyBullMoonEvent(cells[eventIdx].trim());
  const { location, locationUrl } = parseVenue(cells, columnMap);

  return {
    date,
    series: classification.series,
    runNumber: classification.runNumber,
    title: classification.cleanTitle,
    startTime: parseTime(cells, columnMap, classification.series),
    hares: parseHares(cells, columnMap),
    location,
    locationUrl,
    nearestStation: parseStation(cells, columnMap),
  };
}

// ---------------------------------------------------------------------------
// Column mapping + table extraction
// ---------------------------------------------------------------------------

export function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].toLowerCase().trim();
    if (normalized.includes("date") || normalized === "start date") map.set("date", i);
    else if (normalized.includes("time")) map.set("time", i);
    else if (normalized.includes("event")) map.set("event", i);
    else if (normalized.includes("hare")) map.set("hares", i);
    else if (normalized.includes("venue") || normalized.includes("location")) map.set("venue", i);
    else if (normalized.includes("station")) map.set("nearest station", i);
  }
  return map;
}

function extractTableRows($: CheerioAPI): { headers: string[]; rows: string[][] } {
  const tables = $("table").toArray();
  if (tables.length === 0) return { headers: [], rows: [] };

  // Find the first table with 2+ header cells (skip empty/decoration tables)
  let table = $(tables[0]);
  for (const t of tables) {
    if ($(t).find("th").length >= 2) {
      table = $(t);
      break;
    }
  }

  const headers: string[] = [];
  table.find("thead th, tr:first-child th").each((_, el) => {
    headers.push($(el).text().trim());
  });

  if (headers.length === 0) {
    table.find("tr:first-child td").each((_, el) => {
      headers.push($(el).text().trim());
    });
  }

  const rows: string[][] = [];
  const trSelector = table.find("tbody").length > 0 ? "tbody tr" : "tr:not(:first-child)";

  for (const row of table.find(trSelector).toArray()) {
    const cells: string[] = [];
    $(row).find("td").each((_, el) => {
      cells.push($(el).text().trim());
    });
    if (cells.length > 0 && cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Event building + section parsing
// ---------------------------------------------------------------------------

function buildRawEvent(parsed: ParsedBullMoonRun, sourceUrl: string): RawEventData {
  const title = parsed.runNumber
    ? parsed.series === "t3"
      ? `T3 #${parsed.runNumber}`
      : `${DISPLAY_NAME} #${parsed.runNumber}`
    : parsed.title || DISPLAY_NAME;

  const descParts: string[] = [];
  if (parsed.nearestStation) descParts.push(`Nearest station: ${parsed.nearestStation}`);

  return {
    date: parsed.date!,
    kennelTags: [KENNEL_CODE],
    runNumber: parsed.runNumber,
    title,
    hares: parsed.hares,
    location: parsed.location,
    locationUrl: parsed.locationUrl,
    startTime: parsed.startTime,
    sourceUrl,
    description: descParts.length > 0 ? descParts.join("\n") : undefined,
  };
}

/** Build a dedup key for an event. Uses title as fallback for unnumbered events. */
function eventKey(parsed: ParsedBullMoonRun): string {
  return `${parsed.date}:${parsed.runNumber ?? parsed.title}`;
}

interface SectionResult {
  events: RawEventData[];
  count: number;
  errors: string[];
  errorDetails: ErrorDetails;
}

function parseSection(
  page: { ok: true; $: CheerioAPI; fetchDurationMs: number; structureHash: string },
  section: string,
  sourceUrl: string,
  minDate: Date,
  maxDate: Date,
  seenKeys?: Set<string>,
): SectionResult {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const errorDetails: ErrorDetails = {};

  try {
    const { headers, rows } = extractTableRows(page.$);
    const columnMap = buildColumnMap(headers);

    for (const cells of rows) {
      const parsed = parseBullMoonRow(cells, columnMap);
      if (!parsed?.date) continue;

      const key = eventKey(parsed);
      if (seenKeys?.has(key)) continue;
      seenKeys?.add(key);

      const eventDate = new Date(parsed.date + "T12:00:00Z");
      if (eventDate < minDate || eventDate > maxDate) continue;

      events.push(buildRawEvent(parsed, sourceUrl));
    }
  } catch (err) {
    errors.push(`${section} parse error: ${err}`);
    (errorDetails.parse ??= []).push({
      row: 0, section, error: String(err),
    });
  }

  return { events, count: events.length, errors, errorDetails };
}

// ---------------------------------------------------------------------------
// Iframe rendering helper
// ---------------------------------------------------------------------------

/**
 * Render a Wix page and extract Table Master iframe content.
 * frameUrl matches iframe by URL substring — Wix iframe URLs contain the
 * Table Master compId (e.g., "comp-ksnfhbg7"), which disambiguates when
 * multiple Table Master iframes exist on the same page.
 */
function fetchTableMasterPage(pageUrl: string, compId: string) {
  return fetchBrowserRenderedPage(pageUrl, {
    waitFor: "iframe[title='Table Master']",
    frameUrl: compId,
    timeout: 25000,
  });
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class BullMoonAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const upcomingUrl = source.url || "https://www.bullmoonh3.co.uk/upcoming-runs";
    const config = (source.config as Record<string, unknown>) ?? {};
    const recedingUrl = (config.recedingHarelineUrl as string) || null;
    const upcomingCompId = (config.upcomingCompId as string) || "comp-ksnfhbg7";
    const recedingCompId = (config.recedingCompId as string) || "comp-kuzuw71n5";

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const allErrorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 3650);

    let fetchDurationMs = 0;
    // Only captures upcoming page hash — receding is a separate page with its own structure
    let structureHash: string | undefined;
    let upcomingCount = 0;
    let recedingCount = 0;

    // Fetch pages sequentially — NAS browser render is single-concurrency
    const upcomingPage = await fetchTableMasterPage(upcomingUrl, upcomingCompId);

    if (upcomingPage.ok) {
      fetchDurationMs += upcomingPage.fetchDurationMs;
      structureHash = upcomingPage.structureHash;

      const seenKeys = new Set<string>();
      const result = parseSection(upcomingPage, "upcoming-runs", upcomingUrl, minDate, maxDate, seenKeys);
      allEvents.push(...result.events);
      allErrors.push(...result.errors);
      Object.assign(allErrorDetails, result.errorDetails);
      upcomingCount = result.count;

      // Fetch receding hareline after upcoming (sequential to avoid 429)
      if (recedingUrl) {
        const recedingPage = await fetchTableMasterPage(recedingUrl, recedingCompId);

        if (recedingPage.ok) {
          fetchDurationMs += recedingPage.fetchDurationMs;
          const recedingResult = parseSection(recedingPage, "receding-hareline", recedingUrl, minDate, maxDate, seenKeys);
          allEvents.push(...recedingResult.events);
          allErrors.push(...recedingResult.errors);
          Object.assign(allErrorDetails, recedingResult.errorDetails);
          recedingCount = recedingResult.count;
        } else {
          allErrors.push(...recedingPage.result.errors);
        }
      }
    } else {
      allErrors.push(...upcomingPage.result.errors);
    }

    const hasErrors = hasAnyErrors(allErrorDetails);
    return {
      events: allEvents,
      errors: allErrors,
      structureHash,
      errorDetails: hasErrors ? allErrorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "browser-render",
        upcomingParsed: upcomingCount,
        recedingParsed: recedingCount,
        totalEvents: allEvents.length,
        fetchDurationMs,
      },
    };
  }
}
