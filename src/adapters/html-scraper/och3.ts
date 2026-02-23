import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Parse a UK-format date from OCH3 run list text.
 * Formats:
 *   "Sunday 22nd February 2026" → "2026-02-22"
 *   "Monday 23rd February 2026" → "2026-02-23"
 *   "22 February 2026" → "2026-02-22"
 *   "22/02/2026" → "2026-02-22"
 */
export function parseOCH3Date(text: string, fallbackYear?: number): string | null {
  // Try DD/MM/YYYY format first
  const numericMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    let year = parseInt(numericMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try "DDth Month YYYY" or "DD Month YYYY"
  const ordinalMatch = text.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)(?:\s+(\d{2,4}))?/i,
  );
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1], 10);
    const monthNum = MONTHS[ordinalMatch[2].toLowerCase()];
    let year = ordinalMatch[3] ? parseInt(ordinalMatch[3], 10) : fallbackYear;
    if (year !== undefined && year < 100) year += 2000;
    if (monthNum && day >= 1 && day <= 31 && year !== undefined) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Extract the day of week from text, returning the lowercase day name.
 * "Sunday 22nd February 2026" → "sunday"
 */
export function extractDayOfWeek(text: string): string | null {
  const lower = text.toLowerCase();
  for (const day of DAYS_OF_WEEK) {
    if (lower.includes(day)) return day;
  }
  return null;
}

/**
 * Determine start time from day of week.
 * OCH3 alternates: Sunday = 11:00 AM, Monday = 7:30 PM.
 */
export function getStartTimeForDay(dayOfWeek: string | null): string {
  if (dayOfWeek === "sunday") return "11:00";
  if (dayOfWeek === "monday") return "19:30";
  return "11:00"; // default to Sunday time
}

/**
 * Parse a single OCH3 run entry from text content.
 * Weebly-style sites often have runs as paragraphs or list items with:
 * date, day, location, hares.
 */
export function parseOCH3Entry(text: string): RawEventData | null {
  const date = parseOCH3Date(text);
  if (!date) return null;

  const dayOfWeek = extractDayOfWeek(text);
  const startTime = getStartTimeForDay(dayOfWeek);

  // Extract hares: "Hare(s): Name" or "Hare: Name" or "Hares - Name"
  // Stop at newline, end-of-string, or the start of another labeled field (word + colon)
  let hares: string | undefined;
  const hareMatch = text.match(/Hares?\s*[:\-–—]\s*(.+?)(?:\n|$|(?=(?:Location|Where|Start|Venue)\s*[:\-–—]))/i);
  if (hareMatch) {
    const haresText = hareMatch[1].trim();
    if (!/tba|tbd|tbc|needed|required|volunteer/i.test(haresText)) {
      hares = haresText;
    }
  }

  // Extract location: "Location: Place" or "Start: Place" or "Where: Place"
  // Stop at newline, end-of-string, or the start of another labeled field (word + colon)
  let location: string | undefined;
  const locationMatch = text.match(/(?:Location|Start|Where|Venue)\s*[:\-–—]\s*(.+?)(?:\n|$|(?=Hares?\s*[:\-–—]))/i);
  if (locationMatch) {
    location = locationMatch[1].trim();
    if (/^tba|^tbd|^tbc/i.test(location)) location = undefined;
  }

  return {
    date,
    kennelTag: "OCH3",
    hares,
    location,
    startTime,
    sourceUrl: "http://www.och3.org.uk/upcoming-run-list.html",
  };
}


/** Normalize raw text for line-based OCH3 parsing. */
function normalizeOCH3Text(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a single run entry section into a RawEventData. */
function parseRunEntry(
  section: string,
  inferredYear: number | undefined,
  baseUrl: string,
): { entry: RawEventData | null; year: number | undefined } {
  if (!section || /^upcoming runs:?$/i.test(section)) {
    return { entry: null, year: inferredYear };
  }

  const explicitYearMatch = section.match(/\b(20\d{2})\b/);
  if (explicitYearMatch) inferredYear = parseInt(explicitYearMatch[1], 10);

  const date = parseOCH3Date(section, inferredYear);
  if (!date) return { entry: null, year: inferredYear };

  if (!inferredYear) {
    inferredYear = parseInt(date.slice(0, 4), 10);
  }

  const withoutDatePrefix = section
    .replace(/^(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?\s*-?\s*/i, "")
    .trim();

  const segments = withoutDatePrefix.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const title = segments.length > 0 ? segments[0] : undefined;

  let location: string | undefined;
  if (segments.length > 1) {
    location = segments[segments.length - 1];
    if (/details to follow/i.test(location)) location = undefined;
  }

  return {
    entry: {
      date,
      kennelTag: "OCH3",
      title,
      location,
      startTime: getStartTimeForDay(extractDayOfWeek(section)),
      sourceUrl: baseUrl,
    },
    year: inferredYear,
  };
}

function parseOCH3EntriesFromText(text: string, baseUrl: string): RawEventData[] {
  const normalizedText = normalizeOCH3Text(text);

  const dateStartPattern = /(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?/gi;
  const matches = [...normalizedText.matchAll(dateStartPattern)];

  const entries: RawEventData[] = [];
  let inferredYear: number | undefined;

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? -1;
    if (start < 0) continue;

    const end = i + 1 < matches.length
      ? matches[i + 1].index ?? normalizedText.length
      : normalizedText.length;

    const section = normalizedText.slice(start, end).trim();
    const { entry, year } = parseRunEntry(section, inferredYear, baseUrl);
    inferredYear = year;
    if (entry) entries.push(entry);
  }

  return entries;
}

/**
 * Old Coulsdon Hash House Harriers (OCH3) HTML Scraper
 *
 * Scrapes och3.org.uk/upcoming-run-list.html for upcoming runs.
 * The site is a simple static page (Weebly-style) with run entries
 * containing date, day of week, location, and hares.
 * OCH3 alternates: Sunday 11 AM / Monday 7:30 PM weekly.
 */
export class OCH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  /** Strategy 1: Parse from table rows. */
  private parseFromTableRows($: cheerio.CheerioAPI, errorDetails: ErrorDetails): RawEventData[] {
    const events: RawEventData[] = [];
    const tableRows = $("table tr");
    if (tableRows.length <= 1) return events;

    tableRows.each((i, el) => {
      const rowText = $(el).text().trim();
      if (!rowText) return;
      if (/^(date|day|location|hare|#)\s*$/i.test(rowText)) return;

      try {
        const event = parseOCH3Entry(rowText);
        if (event) events.push(event);
      } catch (err) {
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "table", error: String(err), rawText: rowText?.slice(0, 2000) },
        ];
      }
    });
    return events;
  }

  /** Strategy 2: Parse from paragraphs/divs containing dates. */
  private parseFromContentBlocks($: cheerio.CheerioAPI, errorDetails: ErrorDetails): RawEventData[] {
    const events: RawEventData[] = [];
    const blocks = $("p, li, div.paragraph, .wsite-multicol-col, div[class*='run'], div[class*='event']");

    blocks.each((i, el) => {
      const text = $(el).text().trim();
      if (!text || text.length < 10) return;
      if (!parseOCH3Date(text)) return;

      try {
        const event = parseOCH3Entry(text);
        if (event) events.push(event);
      } catch (err) {
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "content", error: String(err), rawText: text?.slice(0, 2000) },
        ];
      }
    });
    return events;
  }

  /** Strategy 4: Split content by date patterns and parse each section. */
  private parseFromDateSections(mainContent: string, errors: string[]): RawEventData[] {
    const events: RawEventData[] = [];
    const datePattern = /(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+)?\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}/gi;
    const matchesIter = [...mainContent.matchAll(datePattern)];
    if (matchesIter.length === 0) return events;

    for (let i = 0; i < matchesIter.length; i++) {
      const matchStart = matchesIter[i].index;
      const matchEnd = i + 1 < matchesIter.length
        ? matchesIter[i + 1].index
        : matchStart + 300;
      const section = mainContent.substring(matchStart, matchEnd);

      try {
        const event = parseOCH3Entry(section);
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing section ${i}: ${err}`);
      }
    }
    return events;
  }

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "http://www.och3.org.uk/upcoming-run-list.html";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [{ url: baseUrl, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // Strategy 1: Table rows
    events.push(...this.parseFromTableRows($, errorDetails));

    // Strategy 2: Content blocks
    if (events.length === 0) {
      events.push(...this.parseFromContentBlocks($, errorDetails));
    }

    // Strategy 3: Line-based parsing
    const mainContent = $("main, .main-content, #content, .wsite-section-wrap, body").first().text();
    const parsedFromLines = parseOCH3EntriesFromText(mainContent, baseUrl);
    if (parsedFromLines.length > events.length) {
      events.length = 0;
      events.push(...parsedFromLines);
    }

    // Strategy 4: Date section splitting
    if (events.length === 0) {
      events.push(...this.parseFromDateSections(mainContent, errors));
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        entriesFound: events.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
