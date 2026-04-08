import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { safeFetch } from "../safe-fetch";
import { USER_AGENT } from "../constants";
import { buildDateWindow } from "../utils";

/**
 * Default API endpoint — only used as a fallback when a Source has no `url`
 * configured (e.g. unit tests). The recurring adapter and the historical
 * backfill both pass the configured URL through explicitly.
 */
export const SELETAR_API_URL_DEFAULT = "https://sh3app.hash.org.sg/php/util/HashController.php";
const KENNEL_TAG = "seletar-h3";
const DEFAULT_START_TIME = "18:00"; // Seletar runs Tuesdays at 6 PM

/**
 * Seletar H3 (Singapore) adapter.
 *
 * The kennel runs an Ionic/Angular PWA at sh3app.hash.org.sg backed by an
 * open JSON API at HashController.php. The endpoint is essentially a thin
 * REST-over-SQL wrapper — POSTing an `action`/`mapObject`/`sqlExtended` body
 * returns rows from the named view. CORS is restricted to the PWA origin
 * but server-side Node ignores CORS entirely.
 *
 * The `vw_hareline` view returns one row per (run × participant), so 14
 * future runs come back as ~40 rows. The adapter groups by `hl_runno` and
 * pulls hares from rows where `hs_type === "H"`.
 *
 * **PII filter:** the raw API response includes member real names, emails,
 * birth dates, phone numbers, and photo paths. The adapter intentionally
 * reads ONLY the fields below and discards everything else:
 *   hl_runno, hl_datetime, hl_runsite, hl_gps, hl_comment, hl_guestfee,
 *   hs_type, mb_hashname (the hash nickname, not the real name)
 */

/**
 * Narrowed view of a `vw_hareline` row from `HashController.php`.
 *
 * **PII filter:** the raw API response also returns `mb_firstname`,
 * `mb_lastname`, `mb_email_id`, `mb_birthdate`, `mb_contact_mobile`,
 * `mb_photo`, etc. We intentionally only declare the fields below — every
 * read goes through this type so PII fields are dropped at the boundary
 * and never persisted or logged.
 */
export interface SeletarRow {
  hl_runno?: number;
  hl_datetime?: string; // "YYYY-MM-DD"
  hl_runsite?: string | null;
  hl_gps?: string | null;
  hl_comment?: string | null;
  hl_guestfee?: string | number | null;
  hs_type?: string | null; // "H" hare, "S" scribe
  mb_hashname?: string | null;
}

interface SeletarApiResponse {
  status?: string;
  count?: number;
  data?: SeletarRow[];
}

/** Build the SQL extension fragment for upcoming events only. */
const UPCOMING_SQL = " where COALESCE(hl_hide_run, 0) != 1 and hl_datetime >= CURDATE() order by hl_datetime asc";

/**
 * Build the SQL extension fragment for the historical archive only.
 *
 * Strict `< CURDATE()` so this query never overlaps the recurring adapter's
 * `>= CURDATE()` window. The two together cover the full kennel history
 * with zero overlap, so the one-shot backfill can never duplicate
 * RawEvents the adapter is also collecting.
 */
export const HISTORICAL_SQL = " where COALESCE(hl_hide_run, 0) != 1 and hl_datetime < CURDATE() order by hl_datetime asc";

/**
 * Fetch rows from the Seletar PWA backend. Used by both the recurring
 * adapter (upcoming only) and the one-shot historical backfill script
 * (full archive). Keeps the headers, body shape, and PII filter in one
 * place. The API URL is passed in by the caller so the configured
 * `Source.url` (or backfill script) is the single source of truth.
 */
export async function fetchSeletarRows(
  apiUrl: string,
  sqlExtended: string,
): Promise<{ rows: SeletarRow[]; error?: { message: string; status?: number }; fetchDurationMs: number }> {
  const fetchStart = Date.now();
  try {
    const res = await safeFetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "select", mapObject: "vw_hareline", sqlExtended }),
    });
    if (!res.ok) {
      return {
        rows: [],
        error: { message: `Seletar HashController API HTTP ${res.status}`, status: res.status },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }
    const json = (await res.json()) as SeletarApiResponse;
    return { rows: json.data ?? [], fetchDurationMs: Date.now() - fetchStart };
  } catch (err) {
    return {
      rows: [],
      error: { message: `Seletar HashController fetch error: ${err instanceof Error ? err.message : String(err)}` },
      fetchDurationMs: Date.now() - fetchStart,
    };
  }
}

/** Parse "1.3590246, 103.7525630" into {latitude, longitude}. */
export function parseSeletarGps(gps: string | null | undefined): { latitude?: number; longitude?: number } {
  if (!gps) return {};
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(gps);
  if (!m) return {};
  return { latitude: Number.parseFloat(m[1]), longitude: Number.parseFloat(m[2]) };
}

export interface GroupSeletarRowsResult {
  events: RawEventData[];
  /** Rows that lacked a run number or datetime (input was malformed). */
  skippedRows: number;
}

/** Group SeletarRow[] by run number, returning one RawEventData per run. */
export function groupSeletarRows(rows: SeletarRow[]): GroupSeletarRowsResult {
  const byRun = new Map<number, SeletarRow[]>();
  let skippedRows = 0;
  for (const row of rows) {
    // PHP/MySQL drivers sometimes return integers as strings; coerce defensively.
    const runNum = Number(row.hl_runno);
    if (!Number.isFinite(runNum) || !row.hl_datetime) {
      skippedRows++;
      continue;
    }
    const arr = byRun.get(runNum) ?? [];
    arr.push(row);
    byRun.set(runNum, arr);
  }

  const events: RawEventData[] = [];
  for (const [runNumber, runRows] of byRun) {
    const head = runRows[0];
    if (!head.hl_datetime) continue;

    const hareNames: string[] = [];
    const seenHares = new Set<string>();
    for (const row of runRows) {
      if (row.hs_type !== "H") continue;
      const name = row.mb_hashname?.trim();
      if (!name || seenHares.has(name)) continue;
      seenHares.add(name);
      hareNames.push(name);
    }

    const { latitude, longitude } = parseSeletarGps(head.hl_gps);
    const title = head.hl_comment?.trim() || `Seletar H3 Run ${runNumber}`;

    events.push({
      date: head.hl_datetime,
      startTime: DEFAULT_START_TIME,
      kennelTag: KENNEL_TAG,
      runNumber,
      title,
      hares: hareNames.length > 0 ? hareNames.join(", ") : undefined,
      location: head.hl_runsite?.trim() || undefined,
      latitude,
      longitude,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return { events, skippedRows };
}

/**
 * Build a PII-safe sample of a malformed row for diagnostics. The raw API
 * response contains member names, emails, phone numbers, etc.; we whitelist
 * only the non-PII `hl_*` / `hs_type` fields here so they can't leak into
 * error logs, GitHub issues, or Sentry breadcrumbs.
 */
function safeRowSample(row: SeletarRow): Record<string, unknown> {
  return {
    hl_runno: row.hl_runno,
    hl_datetime: row.hl_datetime,
    hl_runsite: row.hl_runsite,
    hl_gps: row.hl_gps,
    hl_comment: row.hl_comment,
    hl_guestfee: row.hl_guestfee,
    hs_type: row.hs_type,
  };
}

function buildSkippedRowsError(
  skippedRows: number,
  rows: SeletarRow[],
): { message: string; detail: NonNullable<ErrorDetails["parse"]> } {
  const message = `Seletar API returned ${skippedRows} row(s) with missing hl_runno or hl_datetime — possible schema drift`;
  const bad = rows.find((r) => !Number.isFinite(Number(r.hl_runno)) || !r.hl_datetime);
  const rawText = JSON.stringify(bad ? safeRowSample(bad) : {}).slice(0, 500);
  return { message, detail: [{ row: 0, error: message, rawText }] };
}

export class SeletarH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const apiUrl = source.url || SELETAR_API_URL_DEFAULT;
    const errorDetails: ErrorDetails = {};
    const result = await fetchSeletarRows(apiUrl, UPCOMING_SQL);
    if (result.error) {
      errorDetails.fetch = [{ url: apiUrl, message: result.error.message, status: result.error.status }];
      return { events: [], errors: [result.error.message], errorDetails };
    }

    // Runtime payload shape check — a 200 with a malformed body (e.g. HTML
    // error page, {status:"1"}, non-array data) must not silently succeed,
    // because an empty rows list would trigger the reconciler to cancel
    // live events. Treat any non-array `data` as a fetch error.
    if (!Array.isArray(result.rows)) {
      const message = "Seletar HashController API returned a non-array payload";
      errorDetails.fetch = [{ url: apiUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }

    const allGrouped = groupSeletarRows(result.rows);
    const skippedRows = allGrouped.skippedRows;
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);
    const events = allGrouped.events.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });
    const errors: string[] = [];

    // Surface dropped rows as scrape errors so the reconciler doesn't cancel
    // events on a partially-parsed scrape (it only runs when errors.length === 0).
    if (skippedRows > 0) {
      const { message, detail } = buildSkippedRowsError(skippedRows, result.rows);
      errors.push(message);
      errorDetails.parse = detail;
    }

    return {
      events,
      errors,
      errorDetails: errors.length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        rowsFetched: result.rows.length,
        uniqueRuns: events.length,
        skippedRows,
        fetchDurationMs: result.fetchDurationMs,
      },
    };
  }
}
