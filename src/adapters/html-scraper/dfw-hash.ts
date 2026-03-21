/**
 * DFW Hash House Harriers Calendar Adapter
 *
 * Scrapes dfwhhh.org/calendar/ — a PHP-generated "Martha's Calendar Generator"
 * table-grid calendar covering 4 DFW-area kennels. The page uses a standard
 * month-grid <table> with:
 *   - Row 0: Day-of-week headers (Sun–Sat)
 *   - Subsequent rows: week rows with 7 <td> cells
 *   - Day number as first text in each cell
 *   - <img> icon filename maps to kennel tag
 *   - <em> content contains hare names
 *
 * URL pattern: http://www.dfwhhh.org/calendar/YYYY/$MM-YYYY.php
 * HTTP-only (expired SSL) — uses safeFetch which handles HTTP.
 *
 * Scrapes current month + next month.
 */
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Icon filename → kennel tag mapping.
 * The <img> src attribute ends with one of these filenames.
 */
export const ICON_TO_KENNEL: Record<string, string> = {
  "dallas.png": "DH3",
  "DUH.png": "DUHHH",
  "NoDHHH2.png": "NODUHHH",
  "ftworth.png": "FWH3",
};

/**
 * Build the URL for a given month's calendar page.
 * Format: http://www.dfwhhh.org/calendar/YYYY/$MM-YYYY.php
 */
export function buildDFWMonthUrl(year: number, month: number): string {
  const mm = String(month + 1).padStart(2, "0"); // month is 0-indexed
  return `http://www.dfwhhh.org/calendar/${year}/$${mm}-${year}.php`;
}

/**
 * Extract events from a single month's calendar HTML.
 * @param $ - Cheerio instance loaded with the page HTML
 * @param year - Calendar year
 * @param month - Calendar month (0-indexed)
 * @param sourceUrl - URL of the page (for sourceUrl field)
 * @returns Array of parsed events and any errors
 */
export function extractDFWEvents(
  $: CheerioAPI,
  year: number,
  month: number,
  sourceUrl: string,
): { events: RawEventData[]; errors: string[]; errorDetails: ErrorDetails } {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const errorDetails: ErrorDetails = {};

  // Find the main calendar table — typically the largest table on the page
  const tables = $("table");
  if (tables.length === 0) {
    errors.push("No table found on page");
    return { events, errors, errorDetails };
  }

  // Use the first table that has day-of-week headers
  let calendarTable: Cheerio<AnyNode> | null = null;
  tables.each((_i, table) => {
    const firstRowText = $(table).find("tr").first().text().toLowerCase();
    if (
      firstRowText.includes("sun") &&
      firstRowText.includes("mon") &&
      firstRowText.includes("tue")
    ) {
      calendarTable = $(table);
      return false; // break
    }
  });

  if (!calendarTable) {
    errors.push("No calendar table found (missing day-of-week headers)");
    return { events, errors, errorDetails };
  }

  const rows = (calendarTable as Cheerio<AnyNode>).find("tr");

  rows.each((rowIdx, el) => {
    // Skip the header row (day-of-week names)
    if (rowIdx === 0) return;

    const $row = $(el);
    const cells = $row.children("td");

    // Week rows should have 7 cells
    if (cells.length !== 7) return;

    try {
      cells.each((_j, cell) => {
        const $cell = $(cell);
        const cellText = $cell.text().trim();

        // Skip empty cells
        if (!cellText || cellText === "\u00a0") return;

        // Extract day number — first number in cell text
        const dayMatch = cellText.match(/^(\d{1,2})\b/);
        if (!dayMatch) return;
        const day = parseInt(dayMatch[1], 10);
        if (day < 1 || day > 31) return;

        // Look for event icons — img tags whose src ends with a known filename
        const imgs = $cell.find("img");
        if (imgs.length === 0) return;

        // Build the date string
        const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
        const dateStr = date.toISOString().split("T")[0];

        imgs.each((_k, img) => {
          const src = $(img).attr("src") || "";
          // Match icon filename from the end of the src path
          let kennelTag: string | undefined;
          for (const [icon, tag] of Object.entries(ICON_TO_KENNEL)) {
            if (src.endsWith(icon)) {
              kennelTag = tag;
              break;
            }
          }
          if (!kennelTag) return;

          // Extract hares from <em> tags (before title extraction so we can exclude them)
          const emTexts: string[] = [];
          $cell.find("em").each((_m, em) => {
            const t = $(em).text().trim();
            if (t) emTexts.push(t);
          });
          const hares = emTexts.length > 0 ? emTexts.join(", ") : undefined;

          // Extract title from cell HTML: strip <em>, <img>, <a> tags, convert <br> to spaces
          const cellHtml = $cell.html() ?? "";
          const titleHtml = cellHtml
            .replace(/<em[^>]*>.*?<\/em>/gi, "")
            .replace(/<img[^>]*\/?>/gi, "")
            .replace(/<a[^>]*>.*?<\/a>/gi, "")
            .replace(/<br\s*\/?>/gi, " ");
          let title = titleHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          // Remove leading day number and trailing/leading punctuation
          title = title.replace(/^\d{1,2}\s*/, "").trim();
          title = title.replace(/^[,\-–\s]+|[,\-–\s]+$/g, "").trim();

          const event: RawEventData = {
            date: dateStr,
            kennelTag,
            sourceUrl,
            ...(title && { title }),
            ...(hares && { hares }),
          };

          events.push(event);
        });
      });
    } catch (err) {
      errors.push(`Error parsing row ${rowIdx}: ${err}`);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row: rowIdx, section: "calendar", error: String(err) },
      ];
    }
  });

  return { events, errors, errorDetails };
}

/**
 * DFW Hash House Harriers Calendar Adapter
 *
 * Scrapes current month + next month from the PHP calendar at dfwhhh.org.
 */
export class DFWHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    _source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const now = new Date();
    const currentMonth = now.getUTCMonth();
    const currentYear = now.getUTCFullYear();

    // Next month (handles year rollover)
    const nextMonth = (currentMonth + 1) % 12;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;

    const months = [
      { year: currentYear, month: currentMonth },
      { year: nextYear, month: nextMonth },
    ];

    const fetchStart = Date.now();

    // Fetch both months concurrently
    const results = await Promise.allSettled(
      months.map(async ({ year, month }) => {
        const url = buildDFWMonthUrl(year, month);
        const response = await safeFetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
        });
        return { response, url, year, month };
      }),
    );

    const totalFetchMs = Date.now() - fetchStart;
    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const allErrorDetails: ErrorDetails = {};
    let structureHash: string | undefined;

    for (const result of results) {
      if (result.status === "rejected") {
        const message = `Fetch failed: ${result.reason}`;
        allErrors.push(message);
        allErrorDetails.fetch = [...(allErrorDetails.fetch ?? []), { url: "", message }];
        continue;
      }

      const { response, url, year, month } = result.value;

      if (!response.ok) {
        const message = `HTTP ${response.status} for ${url}`;
        allErrors.push(message);
        allErrorDetails.fetch = [...(allErrorDetails.fetch ?? []), { url, status: response.status, message }];
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      if (!structureHash) {
        structureHash = generateStructureHash(html);
      }

      const { events, errors, errorDetails } = extractDFWEvents($, year, month, url);
      allEvents.push(...events);
      allErrors.push(...errors);

      if (errorDetails.parse?.length) {
        allErrorDetails.parse = [...(allErrorDetails.parse ?? []), ...errorDetails.parse];
      }
    }

    return {
      events: allEvents,
      errors: allErrors,
      structureHash,
      errorDetails: hasAnyErrors(allErrorDetails) ? allErrorDetails : undefined,
      diagnosticContext: {
        monthsFetched: months.length,
        eventsParsed: allEvents.length,
        fetchDurationMs: totalFetchMs,
      },
    };
  }
}
