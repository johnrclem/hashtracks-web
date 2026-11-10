/**
 * Shared helpers for Wix Table Master cross-origin iframe scraping.
 *
 * Wix Table Master is a third-party widget Wix sites embed via an iframe.
 * The DOM it renders is identical regardless of host site:
 *   - The first `<table>` with `>=2 <th>` cells (or first table as fallback)
 *   - Header row in `thead th, tr:first-child th`, with `tr:first-child td`
 *     as a last-resort fallback
 *   - Body rows in `tbody tr` (or `tr:not(:first-child)` if no `<tbody>`)
 *
 * `fetchWixTableMasterCsv` reads the same data without a browser, straight
 * from the widget's CSV endpoint. Today both are consumed by `hhhs.ts`. New Wix Table Master adapters
 * (Samurai H3, New Tokyo Katch, Bull Moon currently inline their own
 * copies) should migrate to this helper rather than continuing to fork it.
 */
import type { CheerioAPI } from "cheerio";
import { MONTHS } from "../utils";
import { safeFetch } from "../safe-fetch";
import { parseCSV } from "../google-sheets/adapter";

/**
 * Pull `(headers, rows)` from the first hareline-shaped `<table>` on the
 * page. Empty headers/rows arrays are returned when no candidate table
 * is present so callers can short-circuit deterministically.
 */
export function extractWixTableRows(
  $: CheerioAPI,
): { headers: string[]; rows: string[][] } {
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
  const trSelector =
    table.find("tbody").length > 0 ? "tbody tr" : "tr:not(:first-child)";

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

/**
 * Strict day/month/year date parse with a caller-supplied regex.
 *
 * The regex must capture three groups in this order: day, month, year.
 * Months may be full names (`December`) or abbreviations (`Dec`) — both
 * lower-case lookups resolve via the shared `MONTHS` table in utils.
 *
 * Returns `YYYY-MM-DD` on success or `null` for any off-format, unknown
 * month, or out-of-range day. Year may be 2- or 4-digit; 2-digit years
 * are promoted to `2000 + yy` (callers that need a different windowing
 * rule should pre-normalize before passing in).
 *
 * Designed for Wix Table Master adapters that publish unambiguous,
 * year-bearing date cells. Adapters with year-less dates ("28-Mar") need
 * a separate forward-window helper — chrono is not used here so any
 * malformed cell fails loud rather than resolving to a guessed value.
 */
export function parseDayMonthYearDate(
  text: string,
  pattern: RegExp,
): string | null {
  const match = pattern.exec(text.trim());
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  let year = Number.parseInt(match[3], 10);
  if (year < 100) year += 2000;

  const month = MONTHS[monthStr];
  if (month === undefined) return null;

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Table Master's Wix app id; its anonymous per-site instance token is in `/_api/v1/access-tokens`. */
const TABLE_MASTER_APP_DEF_ID = "134139f3-f2a0-2c2c-693c-ed22165cfd84";
/** The JSON endpoint the widget's own Angular bundle loads its CSV from (`settingsService.getCSVFileContent`). */
const TABLE_MASTER_FILE_API = "https://wix-visual-data.appspot.com/api/file";

export type WixTableMasterCsvResult =
  | { ok: true; rows: string[][] }
  | { ok: false; error: string };

/**
 * Read a Table Master widget's data as CSV rows (header row first), with two
 * plain HTTP calls instead of a headless render of the Wix page:
 *   1. the site's public `/_api/v1/access-tokens` → the app's instance token;
 *   2. `wix-visual-data.appspot.com/api/file?instance=…&compId=…&isSite=true`
 *      → `{ csvData }`. The endpoint answers 403 without a Referer from the site.
 * `compId` is the widget's Wix component id (e.g. `comp-jxzijgcm`).
 */
export async function fetchWixTableMasterCsv(siteUrl: string, compId: string): Promise<WixTableMasterCsvResult> {
  try {
    const origin = new URL(siteUrl).origin;
    const tokenRes = await safeFetch(`${origin}/_api/v1/access-tokens`, { headers: { Accept: "application/json" } });
    if (!tokenRes.ok) return { ok: false, error: `access-tokens HTTP ${tokenRes.status}` };
    const tokens = (await tokenRes.json()) as { apps?: Record<string, { instance?: unknown }> };
    const instance = tokens.apps?.[TABLE_MASTER_APP_DEF_ID]?.instance;
    if (typeof instance !== "string" || !instance) return { ok: false, error: "no Table Master instance token" };

    const params = new URLSearchParams({ instance, compId, originCompId: "", isSite: "true" });
    const fileRes = await safeFetch(`${TABLE_MASTER_FILE_API}?${params}`, {
      headers: { Accept: "application/json", Referer: `${origin}/` },
    });
    if (!fileRes.ok) return { ok: false, error: `Table Master file HTTP ${fileRes.status}` };
    const body = (await fileRes.json()) as { csvData?: unknown };
    if (typeof body.csvData !== "string") return { ok: false, error: "Table Master file payload has no csvData" };
    return { ok: true, rows: parseCSV(body.csvData) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
