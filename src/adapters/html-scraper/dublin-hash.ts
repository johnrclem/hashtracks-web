/**
 * Dublin Hash House Harriers (DH3) HTML Scraper
 *
 * Scrapes dublinhhh.com/hareline for upcoming runs.
 * The hareline is a Jekyll-generated HTML table with columns:
 *   Day | Date | Time | Hash (series + run#) | Location | Hares | Notes
 *
 * Two run series share the table:
 *   - "Dublin H3 #NNNN"
 *   - "I ♥ Monday #NNN"
 * Both map to the same kennel (DH3).
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage } from "../utils";

/**
 * Parse a single table row into a RawEventData.
 * Exported for unit testing.
 */
export function parseHarelineRow(
  cells: string[],
  hrefs: (string | undefined)[],
  sourceUrl: string,
): RawEventData | null {
  // Expected columns: [0]=day, [1]=date, [2]=time, [3]=hash, [4]=location, [5]=hares, [6]=notes
  if (cells.length < 6) return null;

  const dateText = cells[1]?.trim() ?? "";
  if (!dateText) return null;

  // Handle date ranges like "3–5 July 2026" — take the first date
  const normalizedDate = dateText.replace(/\u2013/g, "-").replace(/&ndash;/g, "-");
  const rangeMatch = normalizedDate.match(/^(\d+)\s*-\s*\d+\s+(.+)/);
  const dateToParse = rangeMatch ? `${rangeMatch[1]} ${rangeMatch[2]}` : normalizedDate;

  const date = chronoParseDate(dateToParse, "en-GB");
  if (!date) return null;

  // Time (24h format like "19:30")
  const timeText = cells[2]?.trim();
  let startTime: string | undefined;
  if (timeText && /^\d{1,2}:\d{2}$/.test(timeText)) {
    const [h, m] = timeText.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      startTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
  }

  // Hash name + run number from column 3: "Dublin H3 #1668" or "I ♥ Monday #410"
  const hashText = cells[3]?.trim() ?? "";
  const runMatch = hashText.match(/#(\d+)/);
  const runNumber = runMatch ? parseInt(runMatch[1], 10) : undefined;

  // Build title from hash text, cleaning up whitespace
  const title = hashText.replace(/\s+/g, " ").trim() || undefined;

  // Location text + Google Maps URL
  const location = cells[4]?.trim() || undefined;
  const locationUrl = hrefs[4] || undefined;

  // Hares
  const haresText = cells[5]?.trim();
  const hares = haresText && !/^tbd$/i.test(haresText) ? haresText : undefined;

  // Source URL from detail page link
  const detailHref = hrefs[3];
  const eventSourceUrl = detailHref
    ? new URL(detailHref, sourceUrl).href
    : sourceUrl;

  // Notes (on-on venue) in column 6
  const notes = cells[6]?.trim() || undefined;
  const description = notes || undefined;

  return {
    date,
    kennelTag: "DH3",
    title,
    hares,
    location,
    locationUrl,
    startTime,
    runNumber,
    sourceUrl: eventSourceUrl,
    description,
  };
}

export class DublinHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://dublinhhh.com/hareline";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const rows = $("table tr");

    rows.each((i, el) => {
      const $row = $(el);
      // Skip header row (has <th> elements)
      if ($row.find("th").length > 0) return;

      try {
        const cells: string[] = [];
        const hrefs: (string | undefined)[] = [];

        $row.find("td").each((_j, td) => {
          const $td = $(td);
          // Replace <br> with space for clean text
          $td.find("br").replaceWith(" ");
          cells.push($td.text().trim());
          // Extract first <a> href if present
          const href = $td.find("a").first().attr("href");
          hrefs.push(href || undefined);
        });

        const event = parseHarelineRow(cells, hrefs, sourceUrl);
        if (event) {
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
