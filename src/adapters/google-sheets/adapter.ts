import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { googleMapsSearchUrl, validateSourceConfig } from "../utils";

/** Config stored in Source.config JSON for Google Sheets sources */
interface GoogleSheetsConfig {
  sheetId: string;
  /** Optional explicit tab names. If omitted, auto-discovers year-prefixed tabs. */
  tabs?: string[];
  columns: {
    runNumber: number;
    specialRun?: number;
    date: number;
    hares: number;
    location: number;
    title: number;
    description?: number;
  };
  kennelTagRules: {
    default: string;
    specialRunMap?: Record<string, string>;
    numericSpecialTag?: string;
  };
  startTimeRules?: {
    byDayOfWeek?: Record<string, string>;
    default?: string;
  };
}

/**
 * Parse dates in multiple formats found across Summit H3 tabs:
 * - "6-15-25" (M-D-YY with hyphens)
 * - "7/1/2024" (M/D/YYYY with slashes)
 * - "6/13/22" (M/DD/YY with slashes)
 */
export function parseDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[/\-]/).map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;

  const [month, day, rawYear] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const year =
    rawYear > 99 ? rawYear : rawYear < 50 ? 2000 + rawYear : 1900 + rawYear;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Infer start time from day of week using config rules.
 * Summit schedule: Mon evenings (summer) = 19:00, Sat afternoons (fall-May) = 15:00
 */
export function inferStartTime(
  dateStr: string,
  rules?: GoogleSheetsConfig["startTimeRules"],
): string | undefined {
  if (!rules) return undefined;
  const d = new Date(dateStr + "T12:00:00Z");
  const dayName = d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return rules.byDayOfWeek?.[dayName] ?? rules.default;
}

/**
 * Minimal CSV parser for Google Sheets export.
 * Handles quoted fields with escaped double-quotes ("").
 */
/** Parse a single CSV field (quoted or unquoted) starting at position startIdx. */
function parseCSVField(text: string, startIdx: number): { value: string; nextIdx: number } {
  const len = text.length;
  let i = startIdx;

  if (i < len && text[i] === '"') { // nosemgrep: object-injection — safe: string char access with integer index
    // Quoted field
    i++;
    let field = "";
    while (i < len) {
      if (text[i] === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          i++; // closing quote
          break;
        }
      } else {
        field += text[i];
        i++;
      }
    }
    return { value: field, nextIdx: i };
  }

  // Unquoted field
  let field = "";
  while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
    field += text[i];
    i++;
  }
  return { value: field, nextIdx: i };
}

/**
 * Minimal CSV parser for Google Sheets export.
 * Handles quoted fields with escaped double-quotes ("").
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      const { value, nextIdx } = parseCSVField(text, i);
      row.push(value);
      i = nextIdx;

      if (i < len && text[i] === ",") {
        i++;
      } else {
        break;
      }
    }

    // Skip line endings
    if (i < len && text[i] === "\r") i++;
    if (i < len && text[i] === "\n") i++;

    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

const mapsUrl = googleMapsSearchUrl;

/** Discover sheet tabs via Sheets API, returning year-prefixed tab names sorted newest-first. */
async function discoverSheetTabs(sheetId: string, apiKey: string): Promise<{ tabNames: string[]; error?: { message: string; url?: string; status?: number } }> {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title&key=${apiKey}`;
  const safeMetaUrl = metaUrl.replace(/key=[^&]+/, "key=***");
  try {
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      const message = `Sheets API error ${metaRes.status}: ${await metaRes.text()}`;
      return { tabNames: [], error: { message, url: safeMetaUrl, status: metaRes.status } };
    }
    const meta = (await metaRes.json()) as {
      sheets: { properties: { title: string } }[];
    };
    const tabNames = meta.sheets
      .map((s) => s.properties.title)
      .filter((name) => /^\d/.test(name))
      .sort((a, b) => a.localeCompare(b))
      .reverse();
    return { tabNames };
  } catch (err) {
    return { tabNames: [], error: { message: `Failed to discover tabs: ${err}` } };
  }
}

/** Resolve kennel tag and run number from a sheet row. Returns null if the row should be skipped. */
function resolveKennelTagFromSheetRow(
  row: string[],
  config: GoogleSheetsConfig,
): { kennelTag: string; runNumber: number | undefined } | null {
  const runNumberCell = row[config.columns.runNumber]?.trim();
  const specialRunCell = config.columns.specialRun != null
    ? row[config.columns.specialRun]?.trim()
    : undefined;

  if (specialRunCell && config.kennelTagRules.specialRunMap) {
    const mapped = new Map(Object.entries(config.kennelTagRules.specialRunMap)).get(specialRunCell);
    if (mapped) {
      return {
        kennelTag: mapped,
        runNumber: runNumberCell ? parseInt(runNumberCell, 10) || undefined : undefined,
      };
    }
  }
  if (specialRunCell && /^\d+$/.test(specialRunCell) && config.kennelTagRules.numericSpecialTag) {
    return {
      kennelTag: config.kennelTagRules.numericSpecialTag,
      runNumber: parseInt(specialRunCell, 10),
    };
  }
  if (runNumberCell && /^\d+$/.test(runNumberCell)) {
    return {
      kennelTag: config.kennelTagRules.default,
      runNumber: parseInt(runNumberCell, 10),
    };
  }
  return null;
}

/** Build a RawEventData from a sheet row. Returns null if the row should be skipped. */
function buildEventFromSheetRow(
  row: string[],
  config: GoogleSheetsConfig,
  sourceUrl: string,
  dateStr: string,
): RawEventData | null {
  const resolved = resolveKennelTagFromSheetRow(row, config);
  if (!resolved) return null;

  const hares = row[config.columns.hares]?.trim() || undefined;
  const location = row[config.columns.location]?.trim() || undefined;
  const title = row[config.columns.title]?.trim() || undefined;
  const writeUp = config.columns.description != null
    ? row[config.columns.description]?.trim()
    : undefined;
  const description = writeUp
    ? writeUp.substring(0, 2000) || undefined
    : undefined;
  const startTime = inferStartTime(dateStr, config.startTimeRules);

  return {
    date: dateStr,
    kennelTag: resolved.kennelTag,
    runNumber: resolved.runNumber,
    title,
    description,
    hares,
    location,
    locationUrl: location ? mapsUrl(location) : undefined,
    startTime,
    sourceUrl,
  };
}

export class GoogleSheetsAdapter implements SourceAdapter {
  type = "GOOGLE_SHEETS" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: GoogleSheetsConfig;
    try {
      config = validateSourceConfig<GoogleSheetsConfig>(
        source.config, "GoogleSheetsAdapter", { sheetId: "string", columns: "object", kennelTagRules: "object" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid source config";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!apiKey) {
      return {
        events: [],
        errors: ["Missing GOOGLE_CALENDAR_API_KEY environment variable"],
        errorDetails: { fetch: [{ message: "Missing GOOGLE_CALENDAR_API_KEY environment variable" }] },
      };
    }

    const days = options?.days ?? 90;
    const now = new Date();
    const minDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const minISO = minDate.toISOString().slice(0, 10);
    const maxISO = maxDate.toISOString().slice(0, 10);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const tabsProcessed: string[] = [];
    const rowsPerTab: Record<string, number> = {};
    let sampleRows: string[][] | undefined;

    // Step 1: Discover tabs via Sheets API (or use explicit tabs from config)
    let tabNames: string[];
    if (config.tabs && config.tabs.length > 0) {
      tabNames = config.tabs;
    } else {
      const discovery = await discoverSheetTabs(config.sheetId, apiKey);
      if (discovery.error) {
        return {
          events: [],
          errors: [discovery.error.message],
          errorDetails: { fetch: [{ url: discovery.error.url, status: discovery.error.status, message: discovery.error.message }] },
        };
      }
      tabNames = discovery.tabNames;
    }

    // Step 2: Process each tab (newest first, stop when all events are too old)
    for (const tabName of tabNames) {
      let csvText: string;
      const csvUrl = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
      try {
        const csvRes = await fetch(csvUrl);
        if (!csvRes.ok) {
          const message = `Failed to fetch tab "${tabName}": ${csvRes.status}`;
          errors.push(message);
          errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: csvUrl, status: csvRes.status, message }];
          continue;
        }
        csvText = await csvRes.text();
      } catch (err) {
        const message = `Error fetching tab "${tabName}": ${err}`;
        errors.push(message);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: csvUrl, message: String(err) }];
        continue;
      }

      tabsProcessed.push(tabName);
      const rows = parseCSV(csvText);
      rowsPerTab[tabName] = rows.length;
      if (rows.length === 0) continue;

      if (sampleRows === undefined) {
        sampleRows = rows.slice(0, 10);
      }

      let tabHasEventsInWindow = false;

      for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        try {
          const dateCell = row[config.columns.date]?.trim();
          if (!dateCell) continue;

          const dateStr = parseDate(dateCell);
          if (!dateStr) continue;

          if (dateStr < minISO || dateStr > maxISO) continue;
          tabHasEventsInWindow = true;

          const event = buildEventFromSheetRow(row, config, source.url, dateStr);
          if (event) events.push(event);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${rowIdx} in tab "${tabName}": ${message}`);
          errorDetails.parse = [...(errorDetails.parse ?? []), {
            row: rowIdx,
            section: tabName,
            error: message,
            rawText: `Tab: ${tabName}, Row: ${rowIdx}`.slice(0, 2000),
          }];
        }
      }

      if (!tabHasEventsInWindow && events.length > 0) {
        break;
      }
    }

    const hasErrorDetails = (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        tabsDiscovered: tabNames,
        tabsProcessed,
        rowsPerTab,
      },
      sampleRows,
    };
  }
}
