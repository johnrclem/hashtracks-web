import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";

/**
 * Parse a single row from the Halve Mein upcoming events table.
 *
 * Expected columns in `.cellbox` table:
 *   0: Run # (number)
 *   1: Day (day of week)
 *   2: Date & Time (e.g., "March 19, 2026 6:00 PM")
 *   3: Place / Location
 *   4: Hare name(s)
 *   5: Directions (link)
 */
export function parseHalveMeinRow(
  cells: string[],
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 4) return null;

  // Column 0: Run number
  const runText = cells[0]?.trim();
  const runNumber = runText ? parseInt(runText, 10) : undefined;

  // Column 2: Date & Time
  const dateTimeText = cells[2]?.trim();
  if (!dateTimeText) return null;

  const date = chronoParseDate(dateTimeText, "en-US");
  if (!date) return null;

  const startTime = parse12HourTime(dateTimeText);

  // Column 3: Location
  const location = cells[3]?.trim() || undefined;

  // Column 4: Hares
  let hares: string | undefined;
  if (cells[4]) {
    const cleaned = cells[4].trim();
    if (cleaned && !/^(?:tbd|tba|tbc|sign\s*up!?)$/i.test(cleaned)) {
      hares = cleaned;
    }
  }

  // Column 5: Directions URL (optional)
  // We extract this at the adapter level from HTML, not from text cells

  const title = runNumber && !isNaN(runNumber)
    ? `HMHHH #${runNumber}`
    : "HMHHH Trail";

  return {
    date,
    kennelTag: "HMHHH",
    runNumber: runNumber && !isNaN(runNumber) ? runNumber : undefined,
    title,
    hares,
    location: location && location.length > 0 ? location : undefined,
    startTime,
    sourceUrl,
  };
}

/**
 * Halve Mein Hash House Harriers (HMHHH) Adapter
 *
 * Scrapes www.hmhhh.com/index.php?log=upcoming.con — a PHP-generated HTML page
 * with a table using `.cellbox` CSS class. Columns include run number, date/time,
 * location, and hare names.
 */
export class HalveMeinAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://www.hmhhh.com/index.php?log=upcoming.con";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let rowIndex = 0;

    // Find table rows — look for .cellbox cells or standard table rows
    const rows = $("table tr").toArray();

    // Skip header row(s) — detect by checking if first cell contains "Run" or "#"
    let headerSkipped = false;

    for (const row of rows) {
      const $row = $(row);
      const cells = $row.find("td").toArray().map((td) => $(td).text().trim());

      // Skip empty rows
      if (cells.length === 0) continue;

      rowIndex++;

      // Skip header row
      if (!headerSkipped) {
        const firstCell = cells[0]?.toLowerCase() || "";
        if (firstCell.includes("run") || firstCell.includes("#") || firstCell.includes("no")) {
          headerSkipped = true;
          continue;
        }
      }

      // Extract direction URL if present
      let locationUrl: string | undefined;
      $row.find("a").each((_i, a) => {
        const href = $(a).attr("href") || "";
        if (href.includes("google") && href.includes("map")) {
          locationUrl = href;
        }
      });

      try {
        const event = parseHalveMeinRow(cells, url);
        if (event) {
          if (locationUrl) {
            event.locationUrl = locationUrl;
          }
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${rowIndex}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: rowIndex,
          error: String(err),
          rawText: cells.join(" | ").slice(0, 2000),
        });
      }
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rowIndex,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
