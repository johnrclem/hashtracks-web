/**
 * HHHS (Hash House Harriers Singapore — "Father Hash") HTML Scraper
 *
 * Scrapes https://www.hhhs.org.sg/hareline for upcoming Monday runs.
 * The site is Wix-hosted with a cross-origin "Table Master" iframe holding
 * the hareline — requires browser rendering via the NAS Playwright service.
 *
 * Table columns: Run#, Date, Hares, Location, Notes
 * Date format: "29 December 2025" (D MMMM YYYY — full month, 4-digit year)
 *
 * Single kennel: HHHS (Singapore, founded 1962 — the 2nd hash kennel in the world).
 * Paired with a lower-trust STATIC_SCHEDULE fallback so a Wix outage does not
 * black out coverage for a founder kennel.
 *
 * Title policy: always synthesized as `"HHHS Trail #<runNumber>"` (or
 * `"HHHS Run"` if the run number is missing). The Notes column is routed
 * to `description`, NOT `title`, because Notes mixes real event names
 * with logistics-only blurbs ("Pizza on site") that would publish as ugly
 * card titles and churn the raw-event fingerprint on every harmless edit.
 */
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  MONTHS,
  stripPlaceholder,
  buildDateWindow,
  fetchBrowserRenderedPage,
} from "../utils";

const KENNEL_CODE = "hhhs";
const DISPLAY_NAME = "HHHS";
const DEFAULT_START_TIME = "18:00";
const SOURCE_TIMEZONE = "Asia/Singapore";
/**
 * Wix Table Master iframe compId. Substring-matched against the iframe `src`.
 * The hareline page hosts two iframes (Table Master + Wix Chat); matching the
 * specific compId disambiguates so we don't render the chat widget by mistake.
 * Confirmed by inspecting SSR HTML at https://www.hhhs.org.sg/hareline (the
 * Table Master parent `<div id="comp-jxzijgcm">`).
 */
const TABLE_MASTER_COMP_ID = "comp-jxzijgcm";

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const HHHS_DATE_RE = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;

/**
 * Strict "D MMMM YYYY" parse → `YYYY-MM-DD` or `null`. We avoid chrono here
 * so off-format input fails loud instead of resolving to a guessed date.
 */
export function parseHHHSDate(text: string): string | null {
  const match = HHHS_DATE_RE.exec(text.trim());
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const year = Number.parseInt(match[3], 10);

  const month = MONTHS[monthStr];
  if (month === undefined) return null;

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/**
 * Normalize a header label by lowercasing and stripping `#`/whitespace so
 * "Run#", "Run #", and "RUN  #" all collapse to "run".
 */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[#\s]+/g, "");
}

export function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const normalized = normalizeHeader(headers[i]);
    if (normalized === "run" || normalized === "runnumber") map.set("runNumber", i);
    else if (normalized === "date") map.set("date", i);
    else if (normalized === "hares" || normalized === "hare") map.set("hares", i);
    else if (normalized === "location" || normalized === "venue") map.set("location", i);
    else if (normalized === "notes" || normalized === "note" || normalized === "theme") {
      map.set("notes", i);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

export interface ParsedHHHSRun {
  date: string;
  runNumber?: number;
  hares?: string;
  location?: string;
  notes?: string;
}

function getCell(
  cells: string[],
  columnMap: Map<string, number>,
  name: string,
): string | undefined {
  const idx = columnMap.get(name);
  if (idx === undefined) return undefined;
  return stripPlaceholder(cells[idx]?.trim());
}

export function parseHHHSRow(
  cells: string[],
  columnMap: Map<string, number>,
): ParsedHHHSRun | null {
  const rawDate = getCell(cells, columnMap, "date");
  if (!rawDate) return null;

  const date = parseHHHSDate(rawDate);
  if (!date) return null;

  const runNumText = getCell(cells, columnMap, "runNumber");
  const parsedRun = runNumText ? Number.parseInt(runNumText, 10) : Number.NaN;
  const runNumber = Number.isFinite(parsedRun) ? parsedRun : undefined;

  return {
    date,
    runNumber,
    hares: getCell(cells, columnMap, "hares"),
    location: getCell(cells, columnMap, "location"),
    notes: getCell(cells, columnMap, "notes"),
  };
}

// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------

function extractTableRows($: CheerioAPI): { headers: string[]; rows: string[][] } {
  const tables = $("table").toArray();
  if (tables.length === 0) return { headers: [], rows: [] };

  const tableEl = tables.find((t) => $(t).find("th").length >= 2) ?? tables[0];
  const table = $(tableEl);

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
    $(row)
      .find("td")
      .each((_, el) => {
        cells.push($(el).text().trim());
      });
    if (cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Event building
// ---------------------------------------------------------------------------

/**
 * Synthesize a stable title (see file-header title policy). Explicit so we
 * side-step `friendlyKennelName()` expanding HHHS to
 * `"Hash House Harriers Singapore H3 Trail #N"` when notes are blank.
 */
export function buildTitle(parsed: ParsedHHHSRun): string {
  // Number.isFinite (not truthiness) so a hypothetical runNumber: 0 still
  // renders as `"HHHS Trail #0"` — matches the contract in parseHHHSRow.
  return Number.isFinite(parsed.runNumber)
    ? `${DISPLAY_NAME} Trail #${parsed.runNumber}`
    : `${DISPLAY_NAME} Run`;
}

function buildRawEvent(parsed: ParsedHHHSRun, sourceUrl: string): RawEventData {
  return {
    date: parsed.date,
    kennelTags: [KENNEL_CODE],
    runNumber: parsed.runNumber,
    title: buildTitle(parsed),
    hares: parsed.hares,
    location: parsed.location,
    startTime: DEFAULT_START_TIME,
    description: parsed.notes,
    sourceUrl,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class HHHSAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url;
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    // Wix renders Table Master cell text client-side via Intl.DateTimeFormat;
    // pinning the browser timezone keeps date strings stable (#960 BCH3 fix).
    const page = await fetchBrowserRenderedPage(sourceUrl, {
      waitFor: "iframe[title='Table Master']",
      frameUrl: TABLE_MASTER_COMP_ID,
      timezoneId: SOURCE_TIMEZONE,
      timeout: 25000,
    });

    if (!page.ok) {
      return page.result;
    }

    const events: RawEventData[] = [];
    const { headers, rows } = extractTableRows(page.$);
    const columnMap = buildColumnMap(headers);

    for (const cells of rows) {
      const parsed = parseHHHSRow(cells, columnMap);
      if (!parsed) continue;

      const eventDate = new Date(parsed.date + "T12:00:00Z");
      if (eventDate < minDate || eventDate > maxDate) continue;

      events.push(buildRawEvent(parsed, sourceUrl));
    }

    return {
      events,
      errors: [],
      structureHash: page.structureHash,
      diagnosticContext: {
        fetchMethod: "browser-render",
        totalEvents: events.length,
        fetchDurationMs: page.fetchDurationMs,
        adapter: "HHHSAdapter",
        displayName: DISPLAY_NAME,
      },
    };
  }
}
