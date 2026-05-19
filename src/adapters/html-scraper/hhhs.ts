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
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  stripPlaceholder,
  buildDateWindow,
  fetchBrowserRenderedPage,
} from "../utils";
import { extractWixTableRows, parseDayMonthYearDate } from "./wix-table-master";

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
 * Strict "D MMMM YYYY" parse → `YYYY-MM-DD` or `null`. Delegates to the
 * shared `parseDayMonthYearDate` helper with an HHHS-specific regex.
 */
export function parseHHHSDate(text: string): string | null {
  return parseDayMonthYearDate(text, HHHS_DATE_RE);
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
    const { headers, rows } = extractWixTableRows(page.$);
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
