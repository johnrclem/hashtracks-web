/**
 * Glasgow Hash House Harriers (Glasgow H3) HTML Scraper
 *
 * Scrapes glasgowh3.co.uk/hareline.php for upcoming runs.
 * The page has THREE <table class="halloffame"> tables in separate parent divs:
 *   1. Glasgow Hash Runs (inside div.row.no-brd) — the one we want
 *   2. UK Events
 *   3. International Events
 *
 * The generic adapter can't scope to just the first table, so we need
 * a custom adapter that targets div.row.no-brd table.halloffame.
 *
 * Columns: Run No | When | Where | Hare / Hares
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage, buildDateWindow } from "../utils";

/**
 * Parse a single row from the Glasgow H3 hareline table.
 * Columns: Run No | When | Where | Hare / Hares
 * Exported for unit testing.
 */
export function parseGlasgowRow(
  cells: string[],
  hrefs: (string | undefined)[],
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 4) return null;

  // Column 0: Run number
  const runDigits = cells[0]?.replace(/\D/g, "");
  const runNumber = runDigits ? parseInt(runDigits, 10) || undefined : undefined;

  // Column 1: Date — en-GB format like "Monday 23 March" (no year)
  const dateText = cells[1]?.trim();
  if (!dateText) return null;
  const date = chronoParseDate(dateText, "en-GB", undefined, { forwardDate: true });
  if (!date) return null;

  // Column 2: Location
  const location = cells[2]?.trim() || undefined;
  const locationUrl = hrefs[2] || undefined;

  // Column 3: Hares
  const haresText = cells[3]?.trim();
  const hares = haresText && !/^(?:tbd|tba|tbc)$/i.test(haresText) ? haresText : undefined;

  // Build title from kennel + run number
  const title = runNumber ? `Glasgow H3 #${runNumber}` : undefined;

  return {
    date,
    kennelTag: "Glasgow H3",
    title,
    hares,
    location,
    locationUrl,
    startTime: "19:00", // "All runs start at 7pm unless stated"
    runNumber,
    sourceUrl,
  };
}

export class GlasgowH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://glasgowh3.co.uk/hareline.php";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days);

    // Target ONLY the Glasgow Hash Runs table — it's inside div.row.no-brd
    let table = $("div.row.no-brd table.halloffame");
    // Fallback: find h2 containing "Glasgow Hash Runs" and get the next table
    if (!table.length) {
      const h2 = $("h2").filter((_i, el) => $(el).text().includes("Glasgow Hash Runs"));
      if (h2.length) {
        table = h2.first().nextAll("table").first();
      }
    }

    if (!table.length) {
      const message = "Could not find Glasgow Hash Runs table";
      return {
        events: [],
        errors: [message],
        errorDetails: { parse: [{ row: 0, error: message }] },
      };
    }

    const rows = table.find("tr");

    rows.each((i, el) => {
      const $row = $(el);
      const tds = $row.find("td");
      // Skip header rows (<th> elements) and empty separator rows
      if ($row.find("th").length > 0 || tds.length < 4) return;

      try {
        const cells: string[] = [];
        const hrefs: (string | undefined)[] = [];

        tds.each((_j, td) => {
          const $td = $(td);
          cells.push($td.text().trim());
          // For location cell (index 2), prefer Google Maps link
          const allLinks = $td.find("a");
          let href: string | undefined;
          allLinks.each((_k, a) => {
            const h = $(a).attr("href");
            if (h && /maps\.(google|app\.goo\.gl)/i.test(h)) {
              href = h;
            }
          });
          if (!href) {
            href = $td.find("a").first().attr("href") || undefined;
          }
          hrefs.push(href);
        });

        const event = parseGlasgowRow(cells, hrefs, sourceUrl);
        if (event) {
          const eventDate = new Date(event.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) return;
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: $row.text().trim().slice(0, 2000),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
