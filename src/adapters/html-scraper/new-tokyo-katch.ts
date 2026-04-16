/**
 * New Tokyo Katch Hash House Harriers HTML Scraper
 *
 * Scrapes newtokyohash.wixsite.com/newtokyokatchhash/hareline for upcoming runs.
 * The site is Wix-hosted with a Table Master cross-origin iframe
 * for the event table — requires browser rendering via NAS Playwright.
 *
 * Table columns: DATE, RUN, VENUE, LINE, HARE, SWEEP, REMARK
 * Date format: "31-Jan-2026", "17-Apr-2026" (DD-Mon-YYYY)
 *
 * Single kennel: New Tokyo Katch (Tokyo area)
 */
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  MONTHS,
  stripPlaceholder,
  buildDateWindow,
  fetchBrowserRenderedPage,
} from "../utils";

const KENNEL_CODE = "new-tokyo-katch";
const DISPLAY_NAME = "New Tokyo Katch";

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse a New Tokyo Katch date string like "31-Jan-2026", "17-Apr-2026".
 * Format: DD-Mon-YYYY.
 * Exported for unit testing.
 */
export function parseNtkDate(text: string): string | null {
  const match = /^(\d{1,2})-(\w+)-(\d{4})$/.exec(text.trim());
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const year = Number.parseInt(match[3], 10);

  const month = MONTHS[monthStr];
  if (month === undefined) return null;

  // Validate day range
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Column mapping + table extraction
// ---------------------------------------------------------------------------

export function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].toLowerCase().trim();
    if (normalized === "date") map.set("date", i);
    else if (normalized === "run") map.set("run", i);
    else if (normalized === "venue") map.set("venue", i);
    else if (normalized === "line") map.set("line", i);
    else if (normalized === "hare") map.set("hare", i);
    else if (normalized === "sweep") map.set("sweep", i);
    else if (normalized === "remark") map.set("remark", i);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

export interface ParsedNtkRun {
  date: string;
  runNumber?: number;
  location?: string;
  line?: string;
  hares?: string;
  remark?: string;
}

/**
 * Parse a single table row from the New Tokyo Katch Table Master widget.
 * Exported for unit testing.
 */
export function parseNtkRow(
  cells: string[],
  columnMap: Map<string, number>,
): ParsedNtkRun | null {
  const dateIdx = columnMap.get("date");
  if (dateIdx === undefined || !cells[dateIdx]) return null;

  const date = parseNtkDate(cells[dateIdx].trim());
  if (!date) return null;

  const runIdx = columnMap.get("run");
  const runText = runIdx !== undefined ? cells[runIdx]?.trim() : undefined;
  const runNumber = runText ? Number.parseInt(runText, 10) : undefined;

  const hareIdx = columnMap.get("hare");
  const hareText = hareIdx !== undefined ? cells[hareIdx]?.trim() : undefined;
  const sweepIdx = columnMap.get("sweep");
  const sweepText = sweepIdx !== undefined ? cells[sweepIdx]?.trim() : undefined;

  const hareParts: string[] = [];
  const hareVal = stripPlaceholder(hareText);
  if (hareVal) hareParts.push(hareVal);
  const sweepVal = stripPlaceholder(sweepText);
  if (sweepVal) hareParts.push(`Sweep: ${sweepVal}`);

  const venueIdx = columnMap.get("venue");
  const location = venueIdx !== undefined ? stripPlaceholder(cells[venueIdx]?.trim()) : undefined;

  const lineIdx = columnMap.get("line");
  const line = lineIdx !== undefined ? stripPlaceholder(cells[lineIdx]?.trim()) : undefined;

  const remarkIdx = columnMap.get("remark");
  const remark = remarkIdx !== undefined ? stripPlaceholder(cells[remarkIdx]?.trim()) : undefined;

  return {
    date,
    runNumber: runNumber && !Number.isNaN(runNumber) ? runNumber : undefined,
    location,
    line,
    hares: hareParts.length > 0 ? hareParts.join("; ") : undefined,
    remark,
  };
}

// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------

function extractTableRows($: CheerioAPI): { headers: string[]; rows: string[][] } {
  const tables = $("table").toArray();
  if (tables.length === 0) return { headers: [], rows: [] };

  let table = $(tables[0]);
  for (const t of tables) {
    if ($(t).find("th").length >= 2) {
      table = $(t);
      break;
    }
  }

  const headers: string[] = [];
  table.find("thead th, tr:first-child th").each((_, el) => {
    headers.push($(el).text().trim());
  });

  if (headers.length === 0) {
    table.find("tr:first-child td").each((_, el) => {
      headers.push($(el).text().trim());
    });
  }

  const rows: string[][] = [];
  const trSelector = table.find("tbody").length > 0 ? "tbody tr" : "tr:not(:first-child)";

  for (const row of table.find(trSelector).toArray()) {
    const cells: string[] = [];
    $(row).find("td").each((_, el) => {
      cells.push($(el).text().trim());
    });
    if (cells.length > 0 && cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Event building
// ---------------------------------------------------------------------------

/**
 * Detect a REMARK column value that signals this is an overseas trip — NTKH4
 * runs an annual "Overseas Run" outside Japan. Returning an empty string tells
 * the merge pipeline to drop the kennel's country bias entirely, so a venue
 * like "Taoyuan" resolves to Taiwan instead of a Tokyo neighborhood. Issue #741.
 */
export function overseasCountryOverride(remark: string | undefined): string | undefined {
  if (!remark) return undefined;
  return /\boverseas\b/i.test(remark) ? "" : undefined;
}

function buildRawEvent(parsed: ParsedNtkRun, sourceUrl: string): RawEventData {
  const title = parsed.runNumber
    ? `${DISPLAY_NAME} #${parsed.runNumber}`
    : DISPLAY_NAME;

  const descParts: string[] = [];
  if (parsed.line) descParts.push(`Line: ${parsed.line}`);
  if (parsed.remark) descParts.push(`Remark: ${parsed.remark}`);

  const countryOverride = overseasCountryOverride(parsed.remark);

  return {
    date: parsed.date,
    kennelTag: KENNEL_CODE,
    runNumber: parsed.runNumber,
    title,
    hares: parsed.hares,
    location: parsed.location,
    sourceUrl,
    description: descParts.length > 0 ? descParts.join("\n") : undefined,
    ...(countryOverride !== undefined ? { countryOverride } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class NewTokyoKatchAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://newtokyohash.wixsite.com/newtokyokatchhash/hareline";

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const allErrorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    const page = await fetchBrowserRenderedPage(sourceUrl, {
      waitFor: "iframe[title='Table Master']",
      frameUrl: "comp-lg062cu2",
      timeout: 25000,
    });

    if (!page.ok) {
      return page.result;
    }

    try {
      const { headers, rows } = extractTableRows(page.$);
      const columnMap = buildColumnMap(headers);

      for (const cells of rows) {
        const parsed = parseNtkRow(cells, columnMap);
        if (!parsed?.date) continue;

        const eventDate = new Date(parsed.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) continue;

        allEvents.push(buildRawEvent(parsed, sourceUrl));
      }
    } catch (err) {
      allErrors.push(`Parse error: ${err}`);
      if (!allErrorDetails.parse) allErrorDetails.parse = [];
      allErrorDetails.parse.push({
        row: 0,
        section: "hareline",
        error: String(err),
      });
    }

    const hasErrors = hasAnyErrors(allErrorDetails);
    return {
      events: allEvents,
      errors: allErrors,
      structureHash: page.structureHash,
      errorDetails: hasErrors ? allErrorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "browser-render",
        totalEvents: allEvents.length,
        fetchDurationMs: page.fetchDurationMs,
      },
    };
  }
}
