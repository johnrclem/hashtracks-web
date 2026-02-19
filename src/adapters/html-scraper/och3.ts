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
export function parseOCH3Date(text: string): string | null {
  // Try DD/MM/YYYY format first
  const numericMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    const year = parseInt(numericMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try "DDth Month YYYY" or "DD Month YYYY"
  const ordinalMatch = text.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/i,
  );
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1], 10);
    const monthNum = MONTHS[ordinalMatch[2].toLowerCase()];
    const year = parseInt(ordinalMatch[3], 10);
    if (monthNum && day >= 1 && day <= 31) {
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
  let hares: string | undefined;
  const hareMatch = text.match(/Hares?\s*[:\-–—]\s*(.+?)(?:\n|$|Location|Where|Start)/i);
  if (hareMatch) {
    const haresText = hareMatch[1].trim();
    if (!/tba|tbd|tbc|needed|required|volunteer/i.test(haresText)) {
      hares = haresText;
    }
  }

  // Extract location: "Location: Place" or "Start: Place" or "Where: Place"
  let location: string | undefined;
  const locationMatch = text.match(/(?:Location|Start|Where|Venue)\s*[:\-–—]\s*(.+?)(?:\n|$|Hare)/i);
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
        errorDetails.fetch = [
          { url: baseUrl, status: response.status, message },
        ];
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

    // Strategy 1: Table rows (if the page uses a table layout)
    const tableRows = $("table tr");
    if (tableRows.length > 1) {
      tableRows.each((i, el) => {
        const rowText = $(el).text().trim();
        if (!rowText) return;
        // Skip header rows
        if (/^(date|day|location|hare|#)\s*$/i.test(rowText)) return;

        try {
          const event = parseOCH3Entry(rowText);
          if (event) {
            events.push(event);
          }
        } catch (err) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: "table", error: String(err) },
          ];
        }
      });
    }

    // Strategy 2: Paragraphs or divs with date-containing text blocks
    if (events.length === 0) {
      const blocks = $("p, li, div.paragraph, .wsite-multicol-col, div[class*='run'], div[class*='event']");
      let entriesFound = 0;

      blocks.each((i, el) => {
        const text = $(el).text().trim();
        if (!text || text.length < 10) return;

        // Only process blocks that contain a date
        if (!parseOCH3Date(text)) return;

        try {
          const event = parseOCH3Entry(text);
          if (event) {
            events.push(event);
            entriesFound++;
          }
        } catch (err) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: "content", error: String(err) },
          ];
        }
      });
    }

    // Strategy 3: Split page content by date patterns and parse each section
    if (events.length === 0) {
      const mainContent = $("main, .main-content, #content, .wsite-section-wrap, body").first().text();
      const datePattern = /(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+)?\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}/gi;
      const matches = mainContent.match(datePattern);

      if (matches) {
        for (let i = 0; i < matches.length; i++) {
          const matchStart = mainContent.indexOf(matches[i]);
          const matchEnd = i + 1 < matches.length
            ? mainContent.indexOf(matches[i + 1])
            : matchStart + 300;
          const section = mainContent.substring(matchStart, matchEnd);

          try {
            const event = parseOCH3Entry(section);
            if (event) {
              events.push(event);
            }
          } catch (err) {
            errors.push(`Error parsing section ${i}: ${err}`);
          }
        }
      }
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
