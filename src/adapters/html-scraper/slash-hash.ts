import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { chronoParseDate, parse12HourTime } from "../utils";

/**
 * Parse a date from SLASH run list text using chrono-node.
 * Handles: "12th March 2026", "Saturday 12th March 2026", "12/03/2026", etc.
 * Requires text to contain a numeric date pattern (digits + month or DD/MM)
 * to avoid false positives from bare day-of-week names like "Sat".
 */
export function parseSlashDate(text: string): string | null {
  // Guard: reject bare day-of-week names that chrono would false-positive on.
  // Split into simple checks to stay under SonarCloud regex complexity limit.
  const hasNumericSlash = /\d{1,2}\s*\//.test(text);
  const hasOrdinalSuffix = /(?:st|nd|rd|th)\s+\w/.test(text);
  const hasMonthYear = /[a-z]{3,}\s+\d{4}/i.test(text);
  const hasDigitMonth = /\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text);
  if (!hasNumericSlash && !hasOrdinalSuffix && !hasMonthYear && !hasDigitMonth) {
    return null;
  }
  return chronoParseDate(text, "en-GB");
}

/**
 * Parse a time string from SLASH run list.
 * "12 Noon" → "12:00"
 * "1pm" → "13:00"
 * "2:30 PM" → "14:30"
 */
export function parseSlashTime(text: string): string | null {
  if (/\b(?:12\s+)?noon\b/i.test(text)) return "12:00";

  // Delegate HH:MM AM/PM to shared utility
  const result = parse12HourTime(text);
  if (result) return result;

  // Handle bare "1pm" (no minutes) — not covered by parse12HourTime
  const bare = text.match(/(\d{1,2})\s*(am|pm)/i);
  if (bare) {
    let hours = parseInt(bare[1], 10);
    const ampm = bare[2].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, "0")}:00`;
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

    const hasErrorDetails = hasAnyErrors(errorDetails);

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
