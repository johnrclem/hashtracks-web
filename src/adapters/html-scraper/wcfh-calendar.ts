import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, MONTHS_ZERO } from "../utils";
import type { AnyNode } from "domhandler";
import type { CheerioAPI, Cheerio } from "cheerio";

/**
 * Parse a month header like "Mar 2026" or "Apr 2026".
 * Returns { month (0-indexed), year } or null.
 */
export function parseMonthHeader(text: string): { month: number; year: number } | null {
  const match = text.trim().match(/^(\w{3,})\s+(\d{4})$/);
  if (!match) return null;
  const monthNum = MONTHS_ZERO[match[1].toLowerCase().slice(0, 3)];
  if (monthNum === undefined) return null;
  return { month: monthNum, year: parseInt(match[2], 10) };
}

/**
 * Extract the day number from a calendar cell's text content.
 * The day number is always the first number in the cell text.
 * E.g. "22 CH3" → 22, "1 B2BH3" → 1, "5 CH3, B2BH3" → 5
 */
export function extractDayNumber(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2})\b/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  if (day < 1 || day > 31) return null;
  return day;
}

/**
 * Known kennel abbreviations used in the WCFH calendar.
 * Maps the abbreviation as it appears on the page to the kennelCode used by the resolver.
 */
const WCFH_PAGE_TO_CODE: Record<string, string> = {
  "BARFH3": "barf-h3",
  "B2BH3": "b2b-h3",
  "JRH3": "jrh3",
  "LH3": "lh3-fl",
  "SBH3": "sbh3",
  "LUSH": "lush",
  "NSAH3": "nsah3",
  "CH3": "circus-h3",
  "SPH3": "sph3-fl",
  "TTH3": "tth3-fl",
  "TBH3": "tbh3-fl",
};

/**
 * Extract kennel abbreviations from a calendar cell.
 * Kennel tags appear as <a> link text within the cell.
 * Returns an array of kennel tags found.
 */
export function extractKennelTags($cell: Cheerio<AnyNode>, $: CheerioAPI): string[] {
  const tags: string[] = [];
  $cell.find("a").each((_i, el) => {
    const text = $(el).text().trim().replace(/[.,\s]+/g, "");
    const code = text ? WCFH_PAGE_TO_CODE[text] : undefined;
    if (code) {
      tags.push(code);
    }
  });
  return tags;
}

/**
 * West Central Florida Hash Calendar Adapter
 *
 * Scrapes jollyrogerh3.com/WCFH_Calendar.htm — a hand-maintained static HTML
 * calendar covering 11 Tampa Bay area kennels. The page uses a single large
 * <table id="table2"> with:
 *   - Row 0: Header/legend banner (nested table with kennel logos)
 *   - Row 1: Day-of-week headers (Sun–Sat)
 *   - Month header rows: single <td colspan="7"> with "MMM YYYY"
 *   - Week rows: 7 <td> cells, day number as first text, kennel tags in <a> links
 */
export class WCFHCalendarAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.jollyrogerh3.com/WCFH_Calendar.htm";

    const fetchResult = await fetchHTMLPage(baseUrl);
    if (!fetchResult.ok) return fetchResult.result;

    const { $, structureHash, fetchDurationMs } = fetchResult;
    return this.parse($, structureHash, fetchDurationMs, baseUrl);
  }

  /** Parse the loaded HTML. Exported for testing. */
  parse(
    $: CheerioAPI,
    structureHash: string,
    fetchDurationMs: number,
    sourceUrl: string,
  ): ScrapeResult {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let currentMonth = -1;
    let currentYear = -1;
    let rowsParsed = 0;

    // Select all top-level rows in #table2
    const rows = $("#table2 > tbody > tr, #table2 > tr");

    rows.each((i, el) => {
      const $row = $(el);
      const cells = $row.children("td");

      // Skip header row (row 0 — legend with nested table) and day-of-week row (row 1)
      if (i < 2) return;

      // Check for month header: single cell with colspan="7"
      if (cells.length === 1) {
        const colspan = cells.first().attr("colspan");
        if (colspan === "7") {
          const headerText = cells.first().text().trim();
          const parsed = parseMonthHeader(headerText);
          if (parsed) {
            currentMonth = parsed.month;
            currentYear = parsed.year;
          }
        }
        return;
      }

      // Week row: expect 7 cells
      if (cells.length !== 7) return;
      if (currentMonth < 0 || currentYear < 0) return;

      try {
        cells.each((_j, cell) => {
          const $cell = $(cell);
          const cellText = $cell.text().trim();

          // Skip empty/padding cells
          if (!cellText || cellText === "\u00a0") return;

          const day = extractDayNumber(cellText);
          if (!day) return;

          const kennelTags = extractKennelTags($cell, $);
          if (kennelTags.length === 0) return;

          // Build UTC noon date
          const date = new Date(Date.UTC(currentYear, currentMonth, day, 12, 0, 0));
          const dateStr = date.toISOString().split("T")[0];

          for (const tag of kennelTags) {
            events.push({
              date: dateStr,
              kennelTag: tag,
              sourceUrl,
            });
          }
        });
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "table", error: String(err) },
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
