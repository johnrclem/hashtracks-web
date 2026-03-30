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
  extractUkPostcode,
  googleMapsSearchUrl,
  parse12HourTime,
  stripPlaceholder,
  buildDateWindow,
  fetchBrowserRenderedPage,
} from "../utils";

const KENNEL_TAG = "Bull Moon";

const EMOJI_RE = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

/** Classify an event from the Event column into a series. */
export interface EventClassification {
  series: "bull-moon" | "t3" | "social" | "special";
  runNumber?: number;
  cleanTitle: string;
}

/**
 * Classify a Bull Moon event from the Event column text.
 * Strips emojis for clean title, extracts run number and series.
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

  const date = new Date(Date.UTC(year, monthNum, day, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

const DEFAULT_TIMES: Record<string, string> = {
  "t3": "18:45",
  "social": "18:45",
  "bull-moon": "12:00",
  "special": "12:00",
};

/** Parsed fields from a single Bull Moon table row. */
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

/**
 * Parse a table row from the Bull Moon Table Master widget.
 * Columns may vary between upcoming and receding hareline tables.
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

  const result: ParsedBullMoonRun = {
    date,
    series: classification.series,
    runNumber: classification.runNumber,
    title: classification.cleanTitle,
  };

  // Time: parse column if present and not TBC, otherwise use series default
  const timeIdx = columnMap.get("time");
  const timeText = timeIdx !== undefined ? cells[timeIdx]?.trim() : undefined;
  const parsedTime = timeText && !/tbc|tbd|tba/i.test(timeText)
    ? parse12HourTime(timeText)
    : null;
  result.startTime = parsedTime ?? DEFAULT_TIMES[classification.series] ?? "12:00";

  // Hares
  const haresIdx = columnMap.get("hares");
  if (haresIdx !== undefined && cells[haresIdx]) {
    result.hares = stripPlaceholder(cells[haresIdx].trim()) ?? undefined;
  }

  // Venue — strip emojis and Clean Air Zone annotations
  const venueIdx = columnMap.get("venue");
  if (venueIdx !== undefined && cells[venueIdx]) {
    const venueText = cells[venueIdx]
      .replace(EMOJI_RE, "")
      .replace(/\s*within\s+CAZ\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const venue = stripPlaceholder(venueText);
    if (venue) {
      result.location = venue;
      const postcode = extractUkPostcode(venue);
      if (postcode) result.locationUrl = googleMapsSearchUrl(postcode);
    }
  }

  // Nearest Station (upcoming page only)
  const stationIdx = columnMap.get("nearest station");
  if (stationIdx !== undefined && cells[stationIdx]) {
    const stationText = cells[stationIdx].trim();
    if (stationText && !/^n\/a$/i.test(stationText)) {
      result.nearestStation = stationText;
    }
  }

  return result;
}

/**
 * Build a column map from table header cells.
 * Maps normalized header names to column indices.
 */
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

/**
 * Extract table rows from rendered HTML.
 * Table Master renders as standard HTML tables.
 */
function extractTableRows(
  $: CheerioAPI,
): { headers: string[]; rows: string[][] } {
  const tables = $("table").toArray();
  if (tables.length === 0) return { headers: [], rows: [] };

  const table = $(tables[0]);

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

/** Build a RawEventData from a parsed row. */
function buildRawEvent(
  parsed: ParsedBullMoonRun,
  sourceUrl: string,
): RawEventData {
  const title = parsed.runNumber
    ? parsed.series === "t3"
      ? `T3 #${parsed.runNumber}`
      : `${KENNEL_TAG} #${parsed.runNumber}`
    : parsed.title || KENNEL_TAG;

  const descParts: string[] = [];
  if (parsed.nearestStation) descParts.push(`Nearest station: ${parsed.nearestStation}`);

  return {
    date: parsed.date!,
    kennelTag: KENNEL_TAG,
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

/** Render a Wix page and extract Table Master iframe content by compId. */
function fetchTableMasterPage(pageUrl: string, compId: string) {
  return fetchBrowserRenderedPage(pageUrl, {
    waitFor: "iframe[title='Table Master']",
    frameUrl: compId,
    timeout: 25000,
  });
}

export class BullMoonAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const upcomingUrl = source.url || "https://www.bullmoonh3.co.uk/upcoming-runs";
    const config = (source.config as Record<string, unknown>) ?? {};
    const recedingUrl = (config.recedingHarelineUrl as string) || null;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 3650);

    let fetchDurationMs = 0;
    let structureHash: string | undefined;
    let upcomingCount = 0;
    let recedingCount = 0;

    // Fetch both pages in parallel (independent browser renders)
    const [upcomingPage, recedingPage] = await Promise.all([
      fetchTableMasterPage(upcomingUrl, "comp-ksnfhbg7"),
      recedingUrl
        ? fetchTableMasterPage(recedingUrl, "comp-kuzuw71n5")
        : Promise.resolve(null),
    ]);

    // --- Process upcoming runs ---
    if (upcomingPage.ok) {
      fetchDurationMs += upcomingPage.fetchDurationMs;
      structureHash = upcomingPage.structureHash;

      try {
        const { headers, rows } = extractTableRows(upcomingPage.$);
        const columnMap = buildColumnMap(headers);

        for (const cells of rows) {
          const parsed = parseBullMoonRow(cells, columnMap);
          if (!parsed?.date) continue;

          const eventDate = new Date(parsed.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) continue;

          events.push(buildRawEvent(parsed, upcomingUrl));
          upcomingCount++;
        }
      } catch (err) {
        errors.push(`Upcoming runs parse error: ${err}`);
        (errorDetails.parse ??= []).push({
          row: 0, section: "upcoming-runs", error: String(err),
        });
      }
    } else {
      errors.push(...upcomingPage.result.errors);
    }

    // --- Process receding hareline ---
    if (recedingPage?.ok) {
      fetchDurationMs += recedingPage.fetchDurationMs;

      try {
        const { headers, rows } = extractTableRows(recedingPage.$);
        const columnMap = buildColumnMap(headers);

        const seenKeys = new Set(
          events.map((e) => `${e.date}:${e.runNumber ?? ""}`),
        );

        for (const cells of rows) {
          const parsed = parseBullMoonRow(cells, columnMap);
          if (!parsed?.date) continue;

          const key = `${parsed.date}:${parsed.runNumber ?? ""}`;
          if (seenKeys.has(key)) continue;

          const eventDate = new Date(parsed.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) continue;

          events.push(buildRawEvent(parsed, recedingUrl!));
          recedingCount++;
        }
      } catch (err) {
        errors.push(`Receding hareline parse error: ${err}`);
        (errorDetails.parse ??= []).push({
          row: 0, section: "receding-hareline", error: String(err),
        });
      }
    } else if (recedingPage && !recedingPage.ok) {
      errors.push(...recedingPage.result.errors);
    }

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "browser-render",
        upcomingParsed: upcomingCount,
        recedingParsed: recedingCount,
        totalEvents: events.length,
        fetchDurationMs,
      },
    };
  }
}
