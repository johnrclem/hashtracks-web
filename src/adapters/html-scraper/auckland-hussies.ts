import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  bumpYearIfBefore,
  chronoParseDate,
  fetchHTMLPage,
  normalizeHaresField,
  stripPlaceholder,
} from "../utils";

/**
 * Auckland Hussies HTML Scraper
 *
 * Source: https://aucklandhussies.co.nz/Run%20List.html — a Microsoft Excel
 * "Save as Web Page" export. Each run is a 6-column `<tr>` whose first cell
 * is a short date like `5-May`; subsequent cells hold hares and address.
 * Annotation rows (phone numbers, "Please text the hare", cost notes) all
 * have an empty first cell, so date-shaped col-0 is the row discriminator.
 *
 * Year inference uses refDate-year + monotonic-walk year bump across the
 * chronologically-sorted run list, so a Dec → Jan rollover correctly maps
 * the January row into next year.
 */

// Allowed date shapes in column 0 — strict `D[D]-MMM` to avoid grabbing
// stray text like "021-420209" (phone numbers in adjacent rows).
const DATE_CELL_RE = /^\s*(\d{1,2})-([A-Za-z]{3})\s*$/;

export interface AucklandHussiesParsedRow {
  dateText: string;
  hareText?: string;
  locationText?: string;
}

/** Type-guard for the kennelTag-bearing source config. */
interface AucklandHussiesConfig {
  kennelTag: string;
}
function isAucklandHussiesConfig(cfg: unknown): cfg is AucklandHussiesConfig {
  return typeof cfg === "object" && cfg !== null && typeof (cfg as { kennelTag?: unknown }).kennelTag === "string";
}

/**
 * Convert one parsed row to RawEventData. Returns null for placeholder /
 * unparseable dates.
 *
 * Year inference uses refDate-year by default; supply `prevDate` to bump
 * forward when the chronologically-sorted run list rolls past a year
 * boundary.
 */
export function parseAucklandHussiesRow(
  row: AucklandHussiesParsedRow,
  opts: { kennelTag: string; sourceUrl: string; referenceDate?: Date; prevDate?: string },
): RawEventData | null {
  const parsed = chronoParseDate(
    row.dateText,
    "en-GB",
    opts.referenceDate,
    { forwardDate: false },
  );
  if (!parsed) return null;
  const date = bumpYearIfBefore(parsed, opts.prevDate);

  const hares = normalizeHaresField(stripPlaceholder(row.hareText));
  // Cheerio decodes &nbsp; to U+00A0, which String#trim already strips, so
  // `stripPlaceholder` cleanly drops cells that hold nothing but &nbsp;.
  const location = stripPlaceholder(row.locationText);

  return {
    date,
    kennelTags: [opts.kennelTag],
    hares,
    location,
    sourceUrl: opts.sourceUrl,
  };
}

export class AucklandHussiesAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://aucklandhussies.co.nz/Run%20List.html";
    if (!isAucklandHussiesConfig(source.config)) {
      return {
        events: [],
        errors: ["AucklandHussiesAdapter requires config.kennelTag"],
        errorDetails: { fetch: [{ url: sourceUrl, message: "Missing kennelTag in source.config" }] },
      };
    }
    const { kennelTag } = source.config;

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    // Excel-exported tables don't have semantic <th>; iterate all rows
    // and rely on the date-shape discriminator in column 0.
    const rows = $("tr").toArray();
    let rowsConsidered = 0;
    let prevDate: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows.at(i);
      if (!row) continue;
      const cells = $(row).find("td").toArray().map((td) => $(td).text());
      if (cells.length < 5) continue;
      const dateCell = cells.at(0)?.trim() ?? "";
      const dateMatch = DATE_CELL_RE.exec(dateCell);
      if (!dateMatch) continue;
      rowsConsidered += 1;

      try {
        const event = parseAucklandHussiesRow(
          { dateText: dateCell, hareText: cells.at(3), locationText: cells.at(4) },
          { kennelTag, sourceUrl, prevDate },
        );
        if (!event) continue;
        prevDate = event.date;
        const eventDate = new Date(`${event.date}T12:00:00Z`);
        if (eventDate < minDate || eventDate > maxDate) continue;
        events.push(event);
      } catch (err) {
        errors.push(`Row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          section: "run-list",
          error: String(err),
          rawText: $(row).text().trim().slice(0, 500),
        });
      }
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsConsidered,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
