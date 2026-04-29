import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, applyDateWindow, isPlaceholder } from "../utils";

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
 * Expected columns: DATE, RUN NO., HARES, DESCRIPTION.
 *
 * The DESCRIPTION column historically held HK district names ("Chai Wan",
 * "Shek O") so #873 mapped it to `location`. The live source has since
 * shifted to event themes / titles ("ANZAC Day Run", "Cinco de Mayo",
 * "LSW Reunion 2026, Bedford", "Birthday run", "Summer Solstice Run").
 *
 * Heuristic split: short single-token-or-two-tokens values are treated as
 * district-shaped venue names (kept on `location`); anything longer or with
 * trailing run-number / theme markers ("Run", "Day", "Hash") goes to
 * `description`. Empty cells stay undefined so the merge UPDATE branch is a
 * no-op (preserves descriptions from other sources / manual edits). #962.
 *
 * Exported for unit testing.
 */
const THEME_MARKER_RE = /\b(?:run|day|night|hash|reunion|crawl|party|year|solstice|virgin)s?\b/i; // NOSONAR — word-boundary-anchored alternation of fixed literals, no nested quantifiers
function classifyDescriptionCell(value: string): { location?: string; description: string } {
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  // Short values without theme keywords look like venue/district names.
  if (tokenCount <= 2 && !THEME_MARKER_RE.test(value)) {
    return { location: value, description: value };
  }
  // Themed text: emit as description only — `sanitizeLocation` doesn't reject
  // arbitrary strings, so leaving it on `location` would surface "ANZAC Day
  // Run" as a venue on the canonical event.
  return { description: value };
}

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

  const value = descCell?.trim() || undefined;
  const classified = value ? classifyDescriptionCell(value) : { location: undefined, description: undefined };

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: runNumber && runNumber > 0 ? runNumber : undefined,
    title: runNumber ? `LSW Run #${runNumber}` : value || undefined,
    hares: validHares,
    location: classified.location,
    description: classified.description,
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
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.datadesignfactory.com/lsw/hareline.htm";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

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
