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
 * Parse a UK-format date from Barnes Hash table text.
 * Formats:
 *   "Wednesday 19th February 2026" → "2026-02-19"
 *   "Wed 19 Feb 2026" → "2026-02-19"
 *   "19th February 2026" → "2026-02-19"
 *   "19/02/2026" → "2026-02-19"
 */
export function parseBarnesDate(text: string): string | null {
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
 * Extract UK postcode from a text string.
 * UK postcodes: "SE11 5JA", "SW18 2SS", "KT20 7ES"
 */
export function extractPostcode(text: string): string | null {
  const match = text.match(/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Parse a run number from text like "#2104" or "Run 2104" or just "2104" at start.
 */
export function parseRunNumber(text: string): number | null {
  const match = text.match(/#?(\d{3,5})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a single Barnes Hash table row into RawEventData.
 * Each row typically contains cells for: run number + date, hare(s), location + details.
 */
export function parseBarnesRow(cells: string[]): RawEventData | null {
  if (cells.length < 2) return null;

  // Strategy: look for a date in all cells combined, then extract other fields
  const allText = cells.join(" ");
  const date = parseBarnesDate(allText);
  if (!date) return null;

  // Run number: look for 3-5 digit number (typically first cell)
  const runNumber = parseRunNumber(cells[0]);

  // Hares: typically in their own cell, look for names (not dates, not postcodes)
  let hares: string | undefined;
  let location: string | undefined;
  let postcode: string | undefined;

  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i].trim();
    if (!cell) continue;

    // Check if this cell contains a postcode (likely location cell)
    const pc = extractPostcode(cell);
    if (pc) {
      postcode = pc;
      // Location is the cell text (pub name + address)
      location = cell;
      continue;
    }

    // If no date in this cell and no postcode, it's likely hares
    if (!parseBarnesDate(cell) && !hares) {
      // Skip cells that look like "On Inn" or directions
      if (/^on[- ]inn/i.test(cell) || /^directions/i.test(cell)) continue;
      hares = cell;
    }
  }

  // If no postcode found yet, check if any cell has location-like content
  if (!location) {
    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i].trim();
      if (cell && /pub|inn|hotel|arms|tavern|head|swan|lion|bell|crown|anchor|horse|plough|red|white|black|star|king|queen|prince|rose|fox/i.test(cell)) {
        location = cell;
        postcode = extractPostcode(cell) ?? undefined;
        break;
      }
    }
  }

  const locationUrl = postcode
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(postcode)}`
    : undefined;

  return {
    date,
    kennelTag: "BarnesH3",
    runNumber: runNumber ?? undefined,
    title: runNumber ? `Barnes Hash Run #${runNumber}` : undefined,
    hares,
    location,
    locationUrl,
    startTime: "19:30",
    sourceUrl: "http://www.barnesh3.com/HareLine.htm",
  };
}

/**
 * Barnes Hash House Harriers (BarnesH3) HTML Scraper
 *
 * Scrapes barnesh3.com/HareLine.htm for upcoming runs. The page is a simple
 * static HTML table with ~8 upcoming runs showing run number, date, hares,
 * and location (pub name + postcode). Weekly Wednesday runs at 7:30 PM.
 */
export class BarnesHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "http://www.barnesh3.com/HareLine.htm";

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

    // Parse table rows — skip header row(s)
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
      if (cells.some((c) => /^(run|date|hare|location|#)\s*$/i.test(c))) return;

      try {
        const event = parseBarnesRow(cells);
        if (event) {
          events.push(event);
        } else {
          // Only report error if there was meaningful content
          const cellText = cells.join(" | ").slice(0, 80);
          if (cellText.trim().length > 5) {
            errorDetails.parse = [
              ...(errorDetails.parse ?? []),
              {
                row: i,
                section: "table",
                error: `Could not parse row: ${cellText}`,
                rawText: cells.join(" | ").slice(0, 2000),
              },
            ];
          }
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
