/**
 * HHHS (Hash House Harriers Singapore — "Father Hash") HTML Scraper
 *
 * Scrapes https://www.hhhs.org.sg/hareline for upcoming Monday runs.
 * The site is Wix-hosted with a cross-origin "Table Master" iframe holding
 * the hareline. The widget loads its data as CSV from its own JSON endpoint,
 * so we read that directly (`fetchWixTableMasterCsv`). Until Nov 2026 we
 * headless-rendered the Wix page and pulled the iframe's table: 37–45 s per
 * render against a 45 s client timeout, and ~41 timeout alerts in 90 days.
 *
 * Table columns: Run#, Date, Hares, Location, Notes (the CSV's run-number
 * header is blank).
 * Date format: "29 December 2025" (D MMMM YYYY — full month, 4-digit year)
 *
 * Single kennel: HHHS (Singapore, founded 1962 — the 2nd hash kennel in the world).
 * Paired with a lower-trust STATIC_SCHEDULE fallback so a Wix outage does not
 * black out coverage for a founder kennel.
 *
 * Title policy: the Notes column carries the run name (no dedicated column
 * exists), but it mixes real run names ("The King's Birthday Run", "Memorial
 * Run") with logistics-only blurbs ("Pizza on site", "Indian Delights on
 * site"). We promote Notes to `title` ONLY when a `" - "`-delimited segment
 * reads like a run name (contains the whole word "Run"/"Hash"); otherwise the
 * title is synthesized as `"HHHS Trail #<runNumber>"` (or `"HHHS Run"` if the
 * run number is missing). This keeps logistics blurbs out of card titles while
 * surfacing the real run name (#2212). The full Notes text is always preserved
 * in `description`.
 */
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { stripPlaceholder, buildDateWindow } from "../utils";
import { fetchWixTableMasterCsv, parseDayMonthYearDate } from "./wix-table-master";

const KENNEL_CODE = "hhhs";
const DISPLAY_NAME = "HHHS";
const DEFAULT_START_TIME = "18:00";
/**
 * Wix component id of the hareline's Table Master widget (the page also hosts
 * a Wix Chat widget). Confirmed in the SSR HTML of
 * https://www.hhhs.org.sg/hareline (`<div id="comp-jxzijgcm">`).
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
    // The CSV leaves the run-number header blank (the widget shows "Run#").
    if (normalized === "run" || normalized === "runnumber" || (i === 0 && normalized === "")) {
      map.set("runNumber", i);
    }
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
 * A Notes cell reads like a run name when one of its `" - "`-delimited segments
 * contains the whole word "Run" or "Hash". Returns that segment (trimming any
 * trailing logistics, e.g. "AGM and Gisbert Memorial Run - T-Shirts" →
 * "AGM and Gisbert Memorial Run"), or undefined for logistics-only notes
 * ("Pizza on site", "Indian Delights on site"). See file-header title policy.
 */
const RUN_NAME_RE = /\b(?:run|hash)\b/i;
export function extractRunName(notes?: string): string | undefined {
  if (!notes) return undefined;
  const segment = notes
    .split(" - ")
    .map((s) => s.trim())
    .find((s) => RUN_NAME_RE.test(s));
  return segment || undefined;
}

/**
 * Title: the run name from Notes when present (see file-header title policy),
 * else a synthesized `"HHHS Trail #<runNumber>"`. The explicit `DISPLAY_NAME`
 * prefix side-steps `friendlyKennelName()` expanding HHHS to
 * `"Hash House Harriers Singapore H3 Trail #N"` when there is no run name.
 */
export function buildTitle(parsed: ParsedHHHSRun): string {
  const runName = extractRunName(parsed.notes);
  if (runName) return runName;
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

    const fetchStart = Date.now();
    const csv = await fetchWixTableMasterCsv(sourceUrl, TABLE_MASTER_COMP_ID);
    const fetchDurationMs = Date.now() - fetchStart;
    if (!csv.ok) {
      const message = `HHHS Table Master fetch failed: ${csv.error}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: sourceUrl, message }] } };
    }

    const [headers = [], ...rows] = csv.rows;
    const columnMap = buildColumnMap(headers);
    // A header drift (no Date column) or an empty sheet must not read as "no
    // runs": reconcile would cancel the whole hareline.
    if (!columnMap.has("date") || rows.length === 0) {
      const message = `HHHS Table Master CSV has no Date column or no rows (headers: ${headers.join("|")})`;
      return { events: [], errors: [message], errorDetails: { parse: [{ row: 0, error: message }] } };
    }

    const events: RawEventData[] = [];
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
      diagnosticContext: {
        fetchMethod: "table-master-csv",
        rowsFetched: rows.length,
        totalEvents: events.length,
        fetchDurationMs,
        adapter: "HHHSAdapter",
        displayName: DISPLAY_NAME,
      },
    };
  }
}
