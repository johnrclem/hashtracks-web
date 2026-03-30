/**
 * Samurai H3 HTML Scraper
 *
 * Scrapes samuraihash2017.wixsite.com/samurai/hare-line for upcoming runs.
 * The site is Wix-hosted with a Table Master cross-origin iframe
 * for the event table — requires browser rendering via NAS Playwright.
 *
 * Table columns: Date, Time, Venue, Train, Hare, Sweep, Fee, Note, #
 * Date format: "28-Mar", "4-April", "11-April" (D-Month, no year — assume current year)
 *
 * Single kennel: Samurai H3 (Tokyo area)
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

const KENNEL_CODE = "samurai-h3";
const DISPLAY_NAME = "Samurai H3";

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Samurai date string like "28-Mar", "4-April", "11-April".
 * No year is provided — assume current year; if the resulting date is
 * more than 3 months in the past, bump to next year.
 * Exported for unit testing.
 */
export function parseSamuraiDate(text: string): string | null {
  const match = /^(\d{1,2})-(\w+)$/.exec(text.trim());
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const month = MONTHS[monthStr];
  if (month === undefined) return null;

  const now = new Date();
  let year = now.getUTCFullYear();

  // Validate day range
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;

  // If the date is more than 3 months in the past, assume next year
  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  if (candidate < threeMonthsAgo) {
    year += 1;
  }

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
    else if (normalized === "time") map.set("time", i);
    else if (normalized === "venue") map.set("venue", i);
    else if (normalized === "train") map.set("train", i);
    else if (normalized === "hare") map.set("hare", i);
    else if (normalized === "sweep") map.set("sweep", i);
    else if (normalized === "fee") map.set("fee", i);
    else if (normalized === "note") map.set("note", i);
    else if (normalized === "#") map.set("runNumber", i);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

export interface ParsedSamuraiRun {
  date: string;
  startTime?: string;
  runNumber?: number;
  location?: string;
  hares?: string;
  fee?: string;
  note?: string;
  train?: string;
}

/**
 * Parse a single table row from the Samurai H3 Table Master widget.
 * Exported for unit testing.
 */
export function parseSamuraiRow(
  cells: string[],
  columnMap: Map<string, number>,
): ParsedSamuraiRun | null {
  const dateIdx = columnMap.get("date");
  if (dateIdx === undefined || !cells[dateIdx]) return null;

  const date = parseSamuraiDate(cells[dateIdx].trim());
  if (!date) return null;

  const timeIdx = columnMap.get("time");
  const timeText = timeIdx !== undefined ? cells[timeIdx]?.trim() : undefined;
  const startTime = timeText && /^\d{1,2}:\d{2}$/.test(timeText) ? timeText : undefined;

  const runNumIdx = columnMap.get("runNumber");
  const runNumText = runNumIdx !== undefined ? cells[runNumIdx]?.trim() : undefined;
  const runNumber = runNumText ? parseInt(runNumText, 10) : undefined;

  const hareIdx = columnMap.get("hare");
  const hareText = hareIdx !== undefined ? cells[hareIdx]?.trim() : undefined;
  const sweepIdx = columnMap.get("sweep");
  const sweepText = sweepIdx !== undefined ? cells[sweepIdx]?.trim() : undefined;

  // Combine hare and sweep into hares string
  const hareParts: string[] = [];
  const hareVal = stripPlaceholder(hareText);
  if (hareVal) hareParts.push(hareVal);
  const sweepVal = stripPlaceholder(sweepText);
  if (sweepVal) hareParts.push(`Sweep: ${sweepVal}`);

  const venueIdx = columnMap.get("venue");
  const location = venueIdx !== undefined ? stripPlaceholder(cells[venueIdx]?.trim()) : undefined;

  const feeIdx = columnMap.get("fee");
  const fee = feeIdx !== undefined ? stripPlaceholder(cells[feeIdx]?.trim()) : undefined;

  const noteIdx = columnMap.get("note");
  const note = noteIdx !== undefined ? stripPlaceholder(cells[noteIdx]?.trim()) : undefined;

  const trainIdx = columnMap.get("train");
  const train = trainIdx !== undefined ? stripPlaceholder(cells[trainIdx]?.trim()) : undefined;

  return {
    date,
    startTime,
    runNumber: runNumber && !isNaN(runNumber) ? runNumber : undefined,
    location,
    hares: hareParts.length > 0 ? hareParts.join("; ") : undefined,
    fee,
    note,
    train,
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

function buildRawEvent(parsed: ParsedSamuraiRun, sourceUrl: string): RawEventData {
  const title = parsed.runNumber
    ? `${DISPLAY_NAME} #${parsed.runNumber}`
    : DISPLAY_NAME;

  const descParts: string[] = [];
  if (parsed.train) descParts.push(`Train: ${parsed.train}`);
  if (parsed.fee) descParts.push(`Fee: ${parsed.fee}`);
  if (parsed.note) descParts.push(`Note: ${parsed.note}`);

  return {
    date: parsed.date,
    kennelTag: KENNEL_CODE,
    runNumber: parsed.runNumber,
    title,
    hares: parsed.hares,
    location: parsed.location,
    startTime: parsed.startTime,
    sourceUrl,
    description: descParts.length > 0 ? descParts.join("\n") : undefined,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SamuraiH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://samuraihash2017.wixsite.com/samurai/hare-line";

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const allErrorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    const page = await fetchBrowserRenderedPage(sourceUrl, {
      waitFor: "iframe[title='Table Master']",
      frameUrl: "comp-j6bd1pcq",
      timeout: 25000,
    });

    if (!page.ok) {
      return page.result;
    }

    try {
      const { headers, rows } = extractTableRows(page.$);
      const columnMap = buildColumnMap(headers);

      for (const cells of rows) {
        const parsed = parseSamuraiRow(cells, columnMap);
        if (!parsed?.date) continue;

        const eventDate = new Date(parsed.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) continue;

        allEvents.push(buildRawEvent(parsed, sourceUrl));
      }
    } catch (err) {
      allErrors.push(`Parse error: ${err}`);
      (allErrorDetails.parse ??= []).push({
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
