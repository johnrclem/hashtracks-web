import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { applyDateWindow, decodeEntities, fetchHTMLPage } from "../utils";

/**
 * Sydney Larrikins (Sydney South Harbour HHH "Tuesday Beers") — sydney.larrikins.org
 *
 * Their "Upcoming Larrikin Runs" page hosts a DataTables grid that is
 * **server-side rendered** — all 19 future `<tr>` rows are present in
 * the initial HTML (Chrome verified). Plain Cheerio works; no
 * browser-render required.
 *
 * Columns:
 *   td.column-1  date    DD/MM/YYYY (UK style)
 *   td.column-2  run #
 *   td.column-3  hare
 *   td.column-4  always empty (kept for future enrichment)
 *
 * Phase 1b ships the basic hareline only — the "Next Run" page (which
 * has location + start time + bring) is deferred to a future enrichment
 * pass.
 */

const KENNEL_TAG = "larrikins-au";
const SOURCE_URL_DEFAULT =
  "https://sydney.larrikins.org/sydney-south-habour-hhh-tuesday-beers/upcoming-larrikin-runs/";

/**
 * Parse a UK-style "D/M/YYYY" date into "YYYY-MM-DD". Returns null on
 * junk. Exported for unit testing.
 */
export function parseLarrikinsDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single Larrikins row into a RawEventData. Returns null when
 * the row is missing the date or run number columns. Exported for unit
 * testing.
 */
export function parseLarrikinsRow(
  dateCell: string,
  runCell: string,
  hareCell: string,
  sourceUrl: string,
): RawEventData | null {
  const date = parseLarrikinsDate(dateCell);
  if (!date) return null;
  const runDigits = runCell.replace(/\D/g, "");
  if (!runDigits) return null;
  const runNumber = Number.parseInt(runDigits, 10);
  const hares = hareCell.trim() || undefined;
  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    hares,
    sourceUrl,
  };
}

export class LarrikinsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || SOURCE_URL_DEFAULT;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const events: RawEventData[] = [];
    const rows = page.$("table tbody tr");
    rows.each((_i, el) => {
      const $row = page.$(el);
      const dateCell = decodeEntities($row.find("td.column-1").text());
      const runCell = decodeEntities($row.find("td.column-2").text());
      const hareCell = decodeEntities($row.find("td.column-3").text());
      if (!dateCell && !runCell) return;
      const event = parseLarrikinsRow(dateCell, runCell, hareCell, url);
      if (event) events.push(event);
    });

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    if (events.length === 0) {
      const message = "Larrikins scraper parsed 0 runs — possible DataTables format drift";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    const days = options?.days ?? source.scrapeDays ?? 180;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: errors.length > 0 ? errorDetails : undefined,
        structureHash: page.structureHash,
        diagnosticContext: {
          fetchMethod: "html-scrape",
          rowsFound: rows.length,
          eventsParsed: events.length,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
