import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { applyDateWindow, decodeEntities, fetchHTMLPage, MONTHS } from "../utils";

/**
 * Gold Coast H3 — goldcoasthash.org
 *
 * The hareline at /hareline/ is rendered server-side via the
 * TablePress WordPress plugin into a single `<table class="tablepress …">`
 * with columns:
 *
 *   Date | Run Number | Hare | Theme
 *
 * Dates are formatted "Month D YYYY" (e.g. "April 13 2026"). The table
 * is future-only — TablePress strips past rows automatically — so we
 * don't need a window guard against leaked history.
 *
 * Phase 1b ships the basic hareline only; the homepage "Next Week's Run"
 * widget (Start time + Location address + Bring) is left for a future
 * enrichment pass to keep this PR small.
 */

const KENNEL_TAG = "gch3-au";
const SOURCE_URL_DEFAULT = "https://www.goldcoasthash.org/hareline/";

/**
 * Parse a Gold Coast date cell like "April 13 2026" → "YYYY-MM-DD".
 * Returns null on junk.
 *
 * Exported for unit testing.
 */
export function parseGoldCoastDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/.exec(trimmed);
  if (!m) return null;
  const monthName = m[1].toLowerCase();
  const month = MONTHS[monthName] ?? MONTHS[monthName.slice(0, 3)];
  if (!month) return null;
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single hareline row into a RawEventData. Returns null when the
 * row is a header, divider, or missing required fields (date + run #).
 *
 * Exported for unit testing.
 */
export function parseGoldCoastRow(
  cells: string[],
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 4) return null;
  const date = parseGoldCoastDate(cells[0]);
  if (!date) return null;
  const runDigits = cells[1].replace(/\D/g, "");
  if (!runDigits) return null;
  const runNumber = Number.parseInt(runDigits, 10);
  const hareRaw = cells[2].trim();
  const themeRaw = cells[3].trim();
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares: hareRaw || undefined,
    title: themeRaw || undefined,
    sourceUrl,
  };
}

export class GoldCoastH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || SOURCE_URL_DEFAULT;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const events: RawEventData[] = [];
    // Match the TablePress hareline table by class prefix; falls back to
    // the first table on the page if class-naming changes.
    let table = page.$("table.tablepress").first();
    if (!table.length) table = page.$("table").first();

    table.find("tbody tr").each((_i, el) => {
      const tds = page.$(el).find("td").toArray();
      if (tds.length === 0) return;
      const cells = tds.map((td) => decodeEntities(page.$(td).text()).trim());
      const event = parseGoldCoastRow(cells, url);
      if (event) events.push(event);
    });

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    if (events.length === 0) {
      const message = "Gold Coast H3 scraper parsed 0 runs — possible TablePress format drift";
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
          rowsParsed: table.find("tbody tr").length,
          eventsParsed: events.length,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
