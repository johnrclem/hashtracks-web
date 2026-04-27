import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, validateSourceConfig, stripPlaceholder } from "../utils";
import { safeFetch } from "../safe-fetch";

/** Titles starting with these verbs are instructions/notes, not event names. */
const INSTRUCTION_TITLE_RE = /^(?:bring|check|don['\u2019]t|remember|note|pack|wear)\b/i;

/**
 * Detects all-lowercase single-token values that look like city/area
 * shorthands typed into a venue column. Some kennels (W3H3) use the same
 * sheet column for both real venue names and city hints; the city-hint
 * rows are usually short, lowercase, and unpunctuated (e.g. "sheperdstown",
 * "harpers", "brunswick").
 *
 * Treating these as venue names produces double-rendered locations like
 * "sheperdstown, Shepherdstown, WV" once the geocoder appends the resolved
 * city. Dropping the value here (caller sets `location = undefined` when
 * this returns `true`) leaves the geocoder with the kennel's region bias
 * still pointing it at the right place — without the typo'd shorthand
 * lingering in user-facing text (#893).
 *
 * Capitalized one-word values like "Charlestown" are intentionally NOT
 * caught \u2014 they could be real venues (e.g. "Subway", "Roxy") and need
 * a different signal (geocoded-city equality) handled downstream.
 */
function isCityShorthand(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 30) return false;
  // Single token, all lowercase letters/apostrophes/hyphens, no whitespace
  // or punctuation. Allows common typo'd or shorthanded city names.
  return /^[a-z][a-z'-]+$/.test(trimmed);
}

/** Config stored in Source.config JSON for Google Sheets sources */
export interface GoogleSheetsConfig {
  sheetId: string;
  /** Optional explicit tab names. If omitted, auto-discovers year-prefixed tabs. */
  tabs?: string[];
  columns: {
    runNumber: number;
    specialRun?: number;
    date: number;
    hares: number;
    /**
     * Additional hare columns to merge with `hares` when the source splits
     * hares across multiple columns (e.g. KH3 has separate Hare1/Hare2 cells).
     * Non-empty cells are joined with " / ", deterministically sorted to keep
     * fingerprints stable when the underlying API reorders columns.
     */
    extraHares?: number[];
    location: number;
    title?: number;
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
  /** Fallback title when title cell is empty/placeholder. Use with runNumber: "${defaultTitle} #${runNumber}" */
  defaultTitle?: string;
  /** Rows to skip before the header row (title rows, notes). Default: 0 */
  skipRows?: number;
  /** Explicit Google Sheet tab gid (numeric). When set, uses export?format=csv&gid=X instead of gviz URL */
  gid?: number;
  /** Direct CSV export URL for anonymous published sheets (e.g., /d/e/.../pub?output=csv). Bypasses tab discovery. */
  csvUrl?: string;
}

/** Month abbreviation → 1-based month number lookup. */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Expand 2-digit years: 0–49 → 2000s, 50–99 → 1900s, ≥100 returned as-is. */
function normalizeYear(rawYear: number): number {
  if (rawYear > 99) return rawYear;
  return rawYear < 50 ? 2000 + rawYear : 1900 + rawYear;
}

/** Format a validated (year, month, day) triple as YYYY-MM-DD, or null if the date is invalid. */
function formatValidDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse D-Mon-YY / DD-Mon-YYYY dates: "3-Jan-26", "20-Dec-25", "15-Mar-2026". */
function parseDMonDate(cleaned: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(cleaned);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const month = MONTH_NAMES[match[2].toLowerCase()];
  if (!month) return null;
  const year = normalizeYear(Number.parseInt(match[3], 10));
  return formatValidDate(year, month, day);
}

/**
 * Parse "Day-name DD MonthName" (no year) — e.g. "Thu 7 May", "Mon 14 Sep".
 * Year is inferred from `today`: among the candidate years (this year, next,
 * or last) whose resulting date is no more than 30 days behind today, pick
 * the one whose absolute distance from today is smallest. This correctly
 * handles dates near the year boundary (a Dec date scraped on Jan 1 resolves
 * to the previous-year December within the grace window, not next December).
 *
 * Gated by the explicit day-name prefix so we don't mis-parse generic
 * "DD MonthName" cells from other layouts.
 */
function parseDayNameDMonNoYear(cleaned: string, today: Date): string | null {
  const match = /^[A-Za-z]{3,9}\s+(\d{1,2})\s+([A-Za-z]{3,9})$/.exec(cleaned);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const monthKey = match[2].slice(0, 3).toLowerCase();
  const month = MONTH_NAMES[monthKey];
  if (!month) return null;

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const graceCutoff = todayUtc - 30 * 86_400_000;

  let best: { date: string; distance: number } | null = null;
  for (const yearOffset of [-1, 0, 1]) {
    const year = today.getUTCFullYear() + yearOffset;
    const candidate = formatValidDate(year, month, day);
    if (!candidate) continue;
    const candidateUtc = Date.UTC(year, month - 1, day);
    if (candidateUtc < graceCutoff) continue;
    const distance = Math.abs(candidateUtc - todayUtc);
    if (best === null || distance < best.distance) {
      best = { date: candidate, distance };
    }
  }
  return best?.date ?? null;
}

/**
 * Parse dates in multiple formats found across hash kennel spreadsheets:
 * - "6-15-25" (M-D-YY with hyphens)
 * - "7/1/2024" (M/D/YYYY with slashes)
 * - "6/13/22" (M/DD/YY with slashes)
 * - "2026-03-29" (YYYY-MM-DD ISO 8601)
 * - "2026/03/07" (YYYY/MM/DD)
 * - "2026/03/07 (Sat)" (YYYY/MM/DD with day-name suffix)
 * - "Thu 7 May" (Day-name DD MonthName, year inferred from `today`)
 *
 * `today` is injectable for testability; defaults to the current UTC date.
 */
export function parseDate(dateStr: string, today: Date = new Date()): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Strip trailing day-name suffix: "2026/03/07 (Sat)" → "2026/03/07"
  const cleaned = trimmed.replace(/\s*\(.*\)\s*$/, "");

  // D-Mon-YY or DD-Mon-YYYY: "3-Jan-26", "20-Dec-25", "15-Mar-2026"
  const dMonResult = parseDMonDate(cleaned);
  if (dMonResult) return dMonResult;

  // "Thu 7 May" / "Mon 14 Sep" — year inferred from today
  const dayNameResult = parseDayNameDMonNoYear(cleaned, today);
  if (dayNameResult) return dayNameResult;

  const parts = cleaned.split(/[/\-]/).map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;

  let year: number, month: number, day: number;

  if (parts[0] > 99) {
    // Year-first: YYYY-MM-DD or YYYY/MM/DD
    [year, month, day] = parts;
  } else {
    // Month-first: M/D/YY or M/D/YYYY
    [month, day, year] = parts;
    year = normalizeYear(year);
  }

  return formatValidDate(year, month, day);
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
/** Parse a quoted CSV field (handles escaped double-quotes). */
function parseQuotedCSVField(text: string, startIdx: number): { value: string; nextIdx: number } {
  const len = text.length;
  let i = startIdx + 1; // skip opening quote
  let field = "";
  while (i < len) {
    if (text[i] === '"') {
      if (i + 1 < len && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else {
        return { value: field, nextIdx: i + 1 }; // closing quote
      }
    } else {
      field += text[i];
      i++;
    }
  }
  return { value: field, nextIdx: i };
}

/** Parse a single CSV field (quoted or unquoted) starting at position startIdx. */
function parseCSVField(text: string, startIdx: number): { value: string; nextIdx: number } {
  const len = text.length;
  let i = startIdx;

  if (i < len && text[i] === '"') { // nosemgrep: object-injection — safe: string char access with integer index
    return parseQuotedCSVField(text, i);
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const metaRes = await safeFetch(metaUrl, { signal: controller.signal });
    if (!metaRes.ok) {
      const message = `Sheets API error ${metaRes.status}: ${await metaRes.text()}`;
      return { tabNames: [], error: { message, url: safeMetaUrl, status: metaRes.status } };
    }
    const meta = await metaRes.json();
    if (!meta || !Array.isArray(meta.sheets)) {
      return { tabNames: [], error: { message: "Unexpected Sheets API response shape", url: safeMetaUrl } };
    }
    const tabNames = (meta.sheets as Array<{ properties?: { title?: string } }>)
      .filter((s) => s.properties?.title)
      .map((s) => s.properties!.title!)
      .filter((name) => /^\d/.test(name))
      .sort((a, b) => a.localeCompare(b))
      .reverse();
    return { tabNames };
  } catch (err) {
    return { tabNames: [], error: { message: `Failed to discover tabs: ${err}`, url: safeMetaUrl } };
  } finally {
    clearTimeout(timeout);
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
        runNumber: runNumberCell ? Number.parseInt(runNumberCell, 10) || undefined : undefined,
      };
    }
  }
  if (specialRunCell && /^\d+$/.test(specialRunCell) && config.kennelTagRules.numericSpecialTag) {
    return {
      kennelTag: config.kennelTagRules.numericSpecialTag,
      runNumber: Number.parseInt(specialRunCell, 10),
    };
  }
  if (runNumberCell && /^\d+$/.test(runNumberCell)) {
    return {
      kennelTag: config.kennelTagRules.default,
      runNumber: Number.parseInt(runNumberCell, 10),
    };
  }
  return null;
}

/** Build a RawEventData from a sheet row. Returns null if the row should be skipped. */
export function buildEventFromSheetRow(
  row: string[],
  config: GoogleSheetsConfig,
  sourceUrl: string,
  dateStr: string,
): RawEventData | null {
  const resolved = resolveKennelTagFromSheetRow(row, config);
  if (!resolved) return null;

  // Strip placeholder values (TBD, TBA, N/A, etc.)
  const primaryHare = stripPlaceholder(row[config.columns.hares]);
  const extraHareCols = config.columns.extraHares ?? [];
  const hares = extraHareCols.length === 0
    ? primaryHare
    : (() => {
        const all = [primaryHare, ...extraHareCols.map((idx) => stripPlaceholder(row[idx]))]
          .filter((h): h is string => Boolean(h));
        if (all.length === 0) return undefined;
        // Deterministic sort so column-order changes don't churn fingerprints.
        all.sort((a, b) => a.localeCompare(b));
        return all.join(" / ");
      })();
  let location = stripPlaceholder(row[config.columns.location]);
  // Drop all-lowercase single-token "city shorthand" values (e.g. "sheperdstown")
  // that aren't real venue names. The merge pipeline still has the kennel's
  // region/country bias for geocoding. See #893.
  if (location && isCityShorthand(location)) {
    location = undefined;
  }
  let title = config.columns.title != null ? stripPlaceholder(row[config.columns.title]) : undefined;

  if (title && INSTRUCTION_TITLE_RE.test(title)) {
    title = undefined;
  }

  // Apply defaultTitle fallback when title is empty
  if (!title && config.defaultTitle) {
    title = resolved.runNumber
      ? `${config.defaultTitle} #${resolved.runNumber}`
      : config.defaultTitle;
  }

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

/** Google Sheets CSV adapter. Fetches published spreadsheet tabs as CSV and parses config-driven column mappings. */
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

    // ── Direct CSV URL mode — skip tab discovery entirely ──
    if (config.csvUrl) {
      return this.fetchDirectCsv(config, source.url, minISO, maxISO, now);
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const tabsProcessed: string[] = [];
    const rowsPerTab: Record<string, number> = {};
    let sampleRows: string[][] | undefined;

    // Step 1: Discover tabs via Sheets API (or use explicit tabs/gid from config)
    let tabNames: string[];
    if (config.tabs && config.tabs.length > 0) {
      tabNames = config.tabs;
    } else if (config.gid != null) {
      // Explicit gid — single tab, no discovery needed
      tabNames = [""];
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
      const csvUrl = config.gid != null
        ? `https://docs.google.com/spreadsheets/d/${config.sheetId}/export?format=csv&gid=${config.gid}`
        : `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
      const csvController = new AbortController();
      const csvTimeout = setTimeout(() => csvController.abort(), 15_000);
      try {
        const csvRes = await safeFetch(csvUrl, { signal: csvController.signal });
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
      } finally {
        clearTimeout(csvTimeout);
      }

      tabsProcessed.push(tabName);
      const rows = parseCSV(csvText);
      if (config.skipRows) {
        rows.splice(0, config.skipRows);
      }
      rowsPerTab[tabName] = rows.length;
      if (rows.length === 0) continue;

      if (sampleRows === undefined) {
        sampleRows = rows.slice(0, 10);
      }

      const processed = this.processRows(rows, config, source.url, minISO, maxISO, now, tabName);
      events.push(...processed.events);
      errors.push(...processed.errors);
      if (processed.parseErrors.length > 0) {
        errorDetails.parse = [...(errorDetails.parse ?? []), ...processed.parseErrors];
      }

      if (!processed.hasEventsInWindow && events.length > 0) {
        break;
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

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

  /** Process parsed CSV rows into events, returning results + parse errors.
   * `today` is the reference timestamp for year-less date inference; pass a
   * single value per fetch so a scrape spanning midnight resolves all rows
   * against the same anchor. */
  private processRows(
    rows: string[][],
    config: GoogleSheetsConfig,
    sourceUrl: string,
    minISO: string,
    maxISO: string,
    today: Date,
    section?: string,
  ): { events: RawEventData[]; errors: string[]; parseErrors: ParseError[]; hasEventsInWindow: boolean } {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const parseErrors: ParseError[] = [];
    let hasEventsInWindow = false;

    for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      try {
        const dateCell = row[config.columns.date]?.trim();
        if (!dateCell) continue;

        const dateStr = parseDate(dateCell, today);
        if (!dateStr) continue;

        if (dateStr < minISO || dateStr > maxISO) continue;
        hasEventsInWindow = true;

        const event = buildEventFromSheetRow(row, config, sourceUrl, dateStr);
        if (event) events.push(event);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const label = section ? `Row ${rowIdx} in tab "${section}"` : `Row ${rowIdx}`;
        errors.push(`${label}: ${message}`);
        parseErrors.push({
          row: rowIdx,
          section,
          error: message,
          rawText: `${label}`.slice(0, 2000),
        });
      }
    }

    return { events, errors, parseErrors, hasEventsInWindow };
  }

  /** Fetch from a direct CSV URL, bypassing tab discovery entirely. */
  private async fetchDirectCsv(
    config: GoogleSheetsConfig,
    sourceUrl: string,
    minISO: string,
    maxISO: string,
    today: Date,
  ): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let csvText: string;
    try {
      const res = await safeFetch(config.csvUrl!, { signal: controller.signal });
      if (!res.ok) {
        const message = `Failed to fetch CSV URL: ${res.status}`;
        return { events: [], errors: [message], errorDetails: { fetch: [{ url: config.csvUrl, status: res.status, message }] } };
      }
      csvText = await res.text();
    } catch (err) {
      const message = `Error fetching CSV URL: ${err}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: config.csvUrl, message: String(err) }] } };
    } finally {
      clearTimeout(timeout);
    }

    const rows = parseCSV(csvText);
    if (config.skipRows) {
      rows.splice(0, config.skipRows);
    }
    if (rows.length === 0) {
      return { events: [], errors: [] };
    }

    const sampleRows = rows.slice(0, 10);

    const processed = this.processRows(rows, config, sourceUrl, minISO, maxISO, today);
    events.push(...processed.events);
    errors.push(...processed.errors);
    const errorDetails: ErrorDetails = {};
    if (processed.parseErrors.length > 0) {
      errorDetails.parse = processed.parseErrors;
    }

    const hasErrs = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrs ? errorDetails : undefined,
      diagnosticContext: { csvUrl: config.csvUrl },
      sampleRows,
    };
  }
}
