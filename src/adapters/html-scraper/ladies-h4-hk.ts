import * as _cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { applyDateWindow, chronoParseDate, isPlaceholder, fetchBrowserRenderedPage } from "../utils";

const KENNEL_TAG = "lh4-hk";
const DEFAULT_START_TIME = "18:45"; // Weekly Tuesdays 6:45pm per research

/**
 * Parse a single Ladies H4 hareline table row into RawEventData.
 * Expected columns: DATE, RUN #, Hares, LOCATION, ON ON
 *
 * Exported for unit testing.
 */
export function parseLadiesH4Row(
  cells: string[],
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 2) return null;

  const [dateCell, runNoCell, haresCell, locationCell, onOnCell] = cells;

  // Parse date using chrono-node with en-GB locale (UK-style dates common in HK)
  const date = chronoParseDate(dateCell ?? "", "en-GB", undefined, { forwardDate: true });
  if (!date) return null;

  const runDigits = runNoCell?.trim().replace(/\D/g, "");
  const runNumber = runDigits ? parseInt(runDigits, 10) : undefined;

  const hares = haresCell?.trim();
  const validHares = hares && !isPlaceholder(hares) ? hares : undefined;

  const location = locationCell?.trim() || undefined;
  const onOn = onOnCell?.trim() || undefined;

  // Build description from on-on venue if present
  const description = onOn ? `On On: ${onOn}` : undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber: runNumber && runNumber > 0 ? runNumber : undefined,
    title: runNumber ? `Ladies H4 Run #${runNumber}` : "Ladies H4 Run",
    hares: validHares,
    location,
    startTime: DEFAULT_START_TIME,
    description,
    sourceUrl,
  };
}

/**
 * HK Ladies Hash House Harriers & Harriets (Ladies H4) Wix Site Scraper
 *
 * Scrapes hkladiesh4.wixsite.com/hklh4/hareline via the NAS headless browser
 * rendering service. The site is built on Wix and requires JS rendering.
 * Table columns: DATE, RUN #, Hares, LOCATION, ON ON.
 * Weekly Tuesday runs at 7pm in Hong Kong.
 */
export class LadiesH4HkAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl = source.url || "https://hkladiesh4.wixsite.com/hklh4/hareline";

    const page = await fetchBrowserRenderedPage(harelineUrl, {
      waitFor: "table",
      timeout: 25000,
    });

    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let rowsParsed = 0;

    // Parse table rows — look for the hareline table
    $("table tr").each((i, el) => {
      const $row = $(el);
      const cells: string[] = [];
      $row.find("td, th").each((_j, cell) => {
        cells.push($(cell).text().trim());
      });

      // Skip header rows
      if (cells.length < 2) return;
      if ($row.find("th").length > 0) return;
      if (cells.some(c => /^(date|run\s*#|hares?|location|on\s*on)\s*$/i.test(c))) return;

      try {
        const event = parseLadiesH4Row(cells, harelineUrl);
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

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          rowsFound: rowsParsed,
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
