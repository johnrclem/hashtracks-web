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
import { chronoParseDate } from "../utils";

/**
 * Parse a UK-format date from Barnes Hash table text using chrono-node.
 * Handles: "Wednesday 19th February 2026", "19/02/2026", "19th February", "19/02", etc.
 */
export function parseBarnesDate(text: string, referenceDate = new Date()): string | null {
  return chronoParseDate(text, "en-GB", referenceDate, { forwardDate: true });
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
/** Find postcode and location from cells, skipping the first cell (run number). */
function findPostcodeAndLocation(cells: string[]): { location: string | undefined; postcode: string | undefined } {
  let location: string | undefined;
  let postcode: string | undefined;

  // First pass: look for cells with a UK postcode
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i].trim();
    if (!cell) continue;

    const pc = extractPostcode(cell);
    if (pc) {
      postcode = pc;
      location = cell;
      return { location, postcode };
    }
  }

  // Second pass: look for pub/venue names
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i].trim();
    if (cell && /pub|inn|hotel|arms|tavern|head|swan|lion|bell|crown|anchor|horse|plough|red|white|black|star|king|queen|prince|rose|fox/i.test(cell)) {
      location = cell;
      postcode = extractPostcode(cell) ?? undefined;
      return { location, postcode };
    }
  }

  return { location, postcode };
}

/** Extract hares from cells, skipping date-containing and postcode-containing cells. */
function extractHaresFromCells(cells: string[]): string | undefined {
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i].trim();
    if (!cell) continue;
    if (extractPostcode(cell)) continue;
    if (parseBarnesDate(cell)) continue;
    if (/^on[- ]inn/i.test(cell) || /^directions/i.test(cell)) continue;
    return cell;
  }
  return undefined;
}

export function parseBarnesRow(cells: string[], sourceUrl = "http://www.barnesh3.com/HareLine.htm"): RawEventData | null {
  if (cells.length < 2) return null;

  const allText = cells.join(" ");
  const date = parseBarnesDate(allText);
  if (!date) return null;

  const runNumber = parseRunNumber(cells[0]);
  const { location, postcode } = findPostcodeAndLocation(cells);
  const hares = extractHaresFromCells(cells);

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
    sourceUrl,
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
        const event = parseBarnesRow(cells, baseUrl);
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
