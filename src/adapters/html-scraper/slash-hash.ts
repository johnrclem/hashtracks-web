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

/**
 * Parse a date from SLASH run list text.
 * Formats:
 *   "12th March 2026" → "2026-03-12"
 *   "Saturday 12th March 2026" → "2026-03-12"
 *   "12 March 2026" → "2026-03-12"
 *   "12/03/2026" → "2026-03-12"
 */
export function parseSlashDate(text: string): string | null {
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
 * Parse a time string from SLASH run list.
 * "12 Noon" → "12:00"
 * "1pm" → "13:00"
 * "2:30 PM" → "14:30"
 */
export function parseSlashTime(text: string): string | null {
  if (/\b(?:12\s+)?noon\b/i.test(text)) return "12:00";

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] || "00";
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, "0")}:${minutes}`;
  }

  return null;
}

/**
 * Parse a single SLASH run table row into RawEventData.
 * Expected cells: [run number, day, date, time, location, hare]
 * or variations thereof.
 */
/** Extract location and hares fields based on column count. */
function extractFieldsByColumnCount(cells: string[]): { location: string | undefined; hares: string | undefined } {
  let location: string | undefined;
  let hares: string | undefined;

  if (cells.length >= 6) {
    location = cells[4].trim() || undefined;
    hares = cells[5].trim() || undefined;
  } else if (cells.length >= 5) {
    location = cells[3].trim() || undefined;
    hares = cells[4].trim() || undefined;
  } else if (cells.length >= 4) {
    location = cells[2].trim() || undefined;
    hares = cells[3].trim() || undefined;
  } else {
    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i].trim();
      if (!cell || parseSlashDate(cell)) continue;
      if (!location) {
        location = cell;
      } else if (!hares) {
        hares = cell;
      }
    }
  }

  return { location, hares };
}

/** Clean TBA/TBC placeholder values from hares and location. */
function cleanupTBAValues(hares: string | undefined, location: string | undefined): { hares: string | undefined; location: string | undefined } {
  const cleanedHares = hares && /^(tba|tbd|tbc|needed|required|\?\??)$/i.test(hares.trim()) ? undefined : hares;
  const cleanedLocation = location && /^(tba|tbd|tbc|\?\??)$/i.test(location.trim()) ? undefined : location;
  return { hares: cleanedHares, location: cleanedLocation };
}

export function parseSlashRow(cells: string[]): RawEventData | null {
  if (cells.length < 3) return null;

  const allText = cells.join(" ");
  const date = parseSlashDate(allText);
  if (!date) return null;

  let runNumber: number | undefined;
  const runMatch = cells[0].match(/(\d{2,5})/);
  if (runMatch) {
    const num = parseInt(runMatch[1], 10);
    if (num >= 1 && num <= 9999) runNumber = num;
  }

  const time = parseSlashTime(allText) ?? "12:00";

  const rawFields = extractFieldsByColumnCount(cells);
  const { hares, location } = cleanupTBAValues(rawFields.hares, rawFields.location);

  return {
    date,
    kennelTag: "SLH3",
    runNumber,
    title: runNumber ? `SLASH Run #${runNumber}` : undefined,
    hares,
    location,
    startTime: time,
    sourceUrl: "https://www.londonhash.org/slah3/runlist/slash3list.html",
  };
}

/**
 * SLASH (South London Hash House Harriers) HTML Scraper
 *
 * Scrapes londonhash.org/slah3/runlist/slash3list.html for upcoming runs.
 * The page is a simple static HTML table showing the annual run list with
 * run number, day, date, time, location, and hare. Monthly kennel (2nd Saturday).
 *
 * Note: This page may be stale (last updated 2022) — zero events is expected.
 */
export class SlashHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl =
      source.url ||
      "https://www.londonhash.org/slah3/runlist/slash3list.html";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
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

    // Parse table rows
    const rows = $("table tr, tr");
    let rowsParsed = 0;

    rows.each((i, el) => {
      const $row = $(el);
      const cells: string[] = [];
      $row.find("td, th").each((_j, cell) => {
        cells.push($(cell).text().trim());
      });

      // Skip header rows and empty rows
      if (cells.length < 2) return;
      if (cells.some((c) => /^(run|#|no\.?|day|date|time|location|hare|venue)\s*$/i.test(c))) return;

      try {
        const event = parseSlashRow(cells);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "table", error: String(err), rawText: cells.join(" | ").slice(0, 2000) },
        ];
      }
      rowsParsed++;
    });

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rowsParsed,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
