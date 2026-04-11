import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { isPlaceholder } from "../utils";

const KENNEL_TAG = "lsw-h3";
const DEFAULT_START_TIME = "18:30"; // Wednesdays in HK, typical evening start

/** Month abbreviation → 1-based month number lookup. */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date string like "09 Apr 25", "23 Jul 26", "DD Mon YY".
 * Returns YYYY-MM-DD or null.
 */
export function parseLswDate(text: string): string | null {
  const match = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/.exec(text.trim());
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const rawYear = parseInt(match[3], 10);

  const month = MONTH_NAMES[monthStr];
  if (!month) return null;

  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  // Validate the date
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single LSW hareline table row into RawEventData.
 * Expected columns: DATE, RUN NO., HARES, DESCRIPTION
 *
 * Exported for unit testing.
 */
export function parseLswRow(
  cells: string[],
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 2) return null;

  const [dateCell, runNoCell, haresCell, descCell] = cells;
  const date = parseLswDate(dateCell ?? "");
  if (!date) return null;

  const runDigits = runNoCell?.trim().replace(/\D/g, "");
  const runNumber = runDigits ? parseInt(runDigits, 10) : undefined;

  const hares = haresCell?.trim();
  const validHares = hares && !isPlaceholder(hares) ? hares : undefined;

  const description = descCell?.trim() || undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber: runNumber && runNumber > 0 ? runNumber : undefined,
    title: runNumber ? `LSW Run #${runNumber}` : description || undefined,
    hares: validHares,
    description,
    startTime: DEFAULT_START_TIME,
    sourceUrl,
  };
}

/**
 * Little Sai Wan Hash House Harriers (LSW) HTML Scraper
 *
 * Scrapes the LSW hareline at datadesignfactory.com/lsw/hareline.htm.
 * Static HTML table with columns: DATE, RUN NO., HARES, DESCRIPTION.
 * Weekly Wednesday runs in Hong Kong.
 */
export class LswH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.datadesignfactory.com/lsw/hareline.htm";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

    let rowsParsed = 0;

    $("table tr").each((i, el) => {
      const $row = $(el);
      const cells: string[] = [];
      $row.find("td").each((_j, cell) => {
        cells.push($(cell).text().trim());
      });

      // Skip header rows (th cells or cells containing header text)
      if (cells.length < 2) return;
      if ($row.find("th").length > 0) return;
      if (cells.some(c => /^(date|run\s*no|hares?|description)\s*\.?\s*$/i.test(c))) return;

      try {
        const event = parseLswRow(cells, baseUrl);
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

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rowsParsed,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
