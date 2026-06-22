/**
 * Saigon Hash House Harriers (Saigon H3) HTML Scraper — first 🇻🇳 Vietnam kennel.
 *
 * Scrapes saigonhashers.com/hareline (the "Receding Hairline"), a bespoke,
 * fully server-rendered hash-club site. The page authors a markdown pipe-table
 * that renders to a real `<table>` with columns:
 *
 *   numbers | Date | Name/Occasion | Hares | A-Site | On-On
 *
 * Dates are year-bearing ISO `YYYY-MM-DD` → no inference (parse straight to
 * UTC noon). The `Name/Occasion` cell is usually the run-TYPE "Bus Trip/City
 * Run" (logistics, not a theme) → title left undefined so merge.ts synthesizes
 * "Saigon H3 Trail #N"; only real occasions/themes are kept as the title. The
 * `Hares` cell carries a "Hares Needed!" placeholder when unassigned → cleared.
 * The A-Site / On-On columns are empty today but, when populated, carry a
 * `maps.app.goo.gl` venue shortlink (no extractable coords) → stored as
 * locationUrl only; the merge pipeline geocodes the HCMC centroid.
 *
 * The deep archive lives at /runs (Run Stats) — a fully SSR'd table of ~800 past
 * runs (numbers | Date | Name/Occasion | Pack Size | Hares | A-Site | On-On).
 * `parseRunsArchive` reads it for the one-shot history backfill
 * (scripts/backfill-saigon-h3-history.ts); the live adapter only reads /hareline.
 */

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ParseError,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, filterEventsByWindow, isPlaceholder } from "../utils";

const KENNEL_TAG = "saigon-h3";
const DEFAULT_URL = "https://saigonhashers.com/hareline";
/**
 * Fixed Sunday departure: the live site banner ("Bus now departs from the
 * Caravelle Hotel at 1:30 pm!") + FAQ ("the bus leaves promptly at 1:30 pm")
 * apply to every run. The table carries no per-event time, so stamp the known
 * departure on every row (mirrors phnom-penh-h3.ts's DEFAULT_START_TIME) rather
 * than leaving trails untimed/sorted-after-timed same-day runs.
 */
const DEFAULT_START_TIME = "13:30";

// Run-number-shaped first cell ("1834"). Decorative / header rows are skipped.
const RUN_CELL_RE = /^\d{2,5}$/;
// Year-bearing ISO date cell "2026-06-21".
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

// The Name/Occasion cell is usually the run-TYPE (logistics), not a theme.
// These normalized labels are dropped so merge.ts synthesizes the default title.
const RUN_TYPE_TITLES = new Set(["bus trip/city run", "bus trip", "city run"]);

// Maps links are validated against an https + host allowlist (mirrors
// phnom-penh-h3.ts / kaohsiung-hash.ts; Codacy flags unvalidated variable URLs).
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);

/**
 * Validate an href against the https + Maps-host allowlist and return the
 * fully-qualified absolute URL (or null). Resolving against the source origin
 * means a protocol-relative ("//maps.app.goo.gl/…") or relative href is stored
 * as an absolute URL the UI can render, never the raw fragment.
 */
function getAbsoluteMapsUrl(href: string): string | null {
  try {
    const parsed = new URL(href, DEFAULT_URL);
    if (parsed.protocol === "https:" && MAPS_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed.href;
    }
  } catch {
    /* malformed href → not a valid Maps URL */
  }
  return null;
}

/** Parse an ISO `YYYY-MM-DD` cell to a UTC-noon `YYYY-MM-DD` string. */
export function parseIsoDate(text: string): string | null {
  const m = ISO_DATE_RE.exec(text.trim());
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Reject overflow (e.g. 2026-02-31 → March).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize a Name/Occasion cell for run-type comparison: lowercase, collapse
 * inner whitespace, and trim whitespace around any "/" separator so both
 * "Bus Trip/City Run" and "Bus Trip / City Run" map to one canonical form.
 * Uses string ops (split/join) over a `\s*\/\s*` regex to avoid Sonar S5852.
 */
function normalizeRunType(text: string): string {
  return text
    .toLowerCase()
    .split("/")
    .map((part) => part.replaceAll(/\s+/g, " ").trim())
    .join("/");
}

/**
 * Discriminate the Name/Occasion cell: keep it as a title only when it's a real
 * occasion/theme; drop the run-TYPE logistics labels (→ undefined) so merge.ts
 * synthesizes "Saigon H3 Trail #N".
 */
function discriminateTitle(text: string): string | undefined {
  const title = text.replaceAll(/\s+/g, " ").trim();
  if (!title || RUN_TYPE_TITLES.has(normalizeRunType(title))) return undefined;
  return title;
}

/**
 * Tri-state cleaner for the Hares cell (mirrors `cleanField` in phnom-penh-h3.ts):
 *   - `undefined` arg (cell absent, e.g. markup drift) → undefined (merge preserves existing)
 *   - present placeholder ("Hares Needed!", TBC/TBA/N/A) / empty → null (merge clears)
 *   - real value → trimmed verbatim (keeps the trailing "& Co")
 * Returning `null` (not `undefined`) for a present placeholder lets a run that
 * flips from a real hare back to "Hares Needed!" clear the stale value through
 * the merge pipeline (atomic-bundle semantics); `undefined` for a missing cell
 * avoids wrongly clearing on a truncated row.
 */
function cleanHares(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const v = value.replaceAll(/\s+/g, " ").trim();
  if (!v || isPlaceholder(v)) return null;
  return v;
}

/** First valid Maps link among the candidate hrefs (in order), as an absolute URL. */
function firstMapsUrl(candidates: (string | undefined)[]): string | undefined {
  for (const href of candidates) {
    if (!href) continue;
    const absolute = getAbsoluteMapsUrl(href);
    if (absolute) return absolute;
  }
  return undefined;
}

/**
 * Extract trimmed cell text + each cell's first-anchor href from a table row
 * (<br> → space). Shared by the live hareline loop and the /runs archive loop.
 */
function extractRowCells(
  $: cheerio.CheerioAPI,
  row: Element,
): { cells: string[]; hrefs: (string | undefined)[] } {
  const cells: string[] = [];
  const hrefs: (string | undefined)[] = [];
  $(row)
    .find("td")
    .each((_j, td) => {
      const $td = $(td);
      $td.find("br").replaceWith(" ");
      cells.push($td.text().trim());
      hrefs.push($td.find("a").first().attr("href") || undefined);
    });
  return { cells, hrefs };
}

interface SaigonRowInput {
  runNumber: number;
  date: string; // already a validated UTC-noon "YYYY-MM-DD"
  occasion: string;
  hares: string | undefined;
  locationUrl: string | undefined;
  sourceUrl: string;
}

/**
 * Build a RawEventData from already-extracted cell values, applying the shared
 * title discrimination + hare cleaning. Used by both the live hareline parse and
 * the /runs archive backfill so they emit identical shapes.
 */
export function buildSaigonRawEvent(input: SaigonRowInput): RawEventData {
  return {
    date: input.date,
    kennelTags: [KENNEL_TAG],
    runNumber: input.runNumber,
    title: discriminateTitle(input.occasion),
    hares: cleanHares(input.hares),
    locationUrl: input.locationUrl,
    startTime: DEFAULT_START_TIME,
    sourceUrl: input.sourceUrl,
  };
}

/**
 * Parse a single hareline `<table>` row into a RawEventData.
 * Returns null for header/decorative rows or an unparseable date.
 * Exported for unit testing.
 *
 * Columns: [0]=numbers [1]=Date [2]=Name/Occasion [3]=Hares [4]=A-Site [5]=On-On
 */
export function parseHarelineRow(
  cells: string[],
  hrefs: (string | undefined)[],
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 4) return null;

  const firstCell = cells[0]?.trim() ?? "";
  if (!RUN_CELL_RE.test(firstCell)) return null;
  const runNumber = Number.parseInt(firstCell, 10);

  const date = parseIsoDate(cells[1] ?? "");
  if (!date) return null;

  return buildSaigonRawEvent({
    runNumber,
    date,
    occasion: cells[2] ?? "",
    hares: cells[3],
    locationUrl: firstMapsUrl([hrefs[4], hrefs[5]]), // A-Site, then On-On
    sourceUrl,
  });
}

/**
 * Parse the /runs (Run Stats) archive into historical RawEventData rows for the
 * one-shot backfill. The archive is the FIRST `<table>` on the page (the rest
 * are per-run "Hash Name / Hare" detail panels). Its columns carry an extra
 * "Pack Size" vs the hareline:
 *
 *   [0]=numbers [1]=Date [2]=Name/Occasion [3]=Pack Size [4]=Hares [5]=A-Site [6]=On-On
 *
 * Returns every parseable run (past + the single current row); the backfill
 * runner partitions to strictly-past dates. Exported for unit testing + backfill.
 */
export function parseRunsArchive(html: string, sourceUrl: string): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("table").first().find("tr").each((_i, el) => {
    if ($(el).find("th").length > 0) return; // skip header rows
    const { cells, hrefs } = extractRowCells($, el);

    if (cells.length < 5) return; // need at least numbers..Hares
    const firstCell = cells[0]?.trim() ?? "";
    if (!RUN_CELL_RE.test(firstCell)) return;
    const date = parseIsoDate(cells[1] ?? "");
    if (!date) return;

    events.push(
      buildSaigonRawEvent({
        runNumber: Number.parseInt(firstCell, 10),
        date,
        occasion: cells[2] ?? "",
        hares: cells[4], // Hares is col 4 here (Pack Size is col 3)
        locationUrl: firstMapsUrl([hrefs[5], hrefs[6]]), // A-Site, then On-On
        sourceUrl,
      }),
    );
  });

  return events;
}

export class SaigonH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const parseErrors: ParseError[] = [];
    const errorDetails: ErrorDetails = {};

    const rows = $("table tr");
    rows.each((i, el) => {
      const $row = $(el);
      if ($row.find("th").length > 0) return; // skip header rows
      const { cells, hrefs } = extractRowCells($, el);

      const firstCell = cells[0]?.trim() ?? "";
      if (!RUN_CELL_RE.test(firstCell)) return; // decorative / non-run row

      try {
        const event = parseHarelineRow(cells, hrefs, sourceUrl);
        if (!event) {
          // A numbered run row whose date no longer parses is markup drift, not
          // a legitimately-absent run. Record a parse error so fetch() surfaces
          // it and reconcile is suppressed (don't false-CANCEL a listed run).
          parseErrors.push({
            row: i,
            section: "hareline",
            field: "date",
            error: `Saigon H3: could not parse run row "${firstCell}"`,
            rawText: $row.text().trim().slice(0, 200),
          });
          return;
        }
        events.push(event);
      } catch (err) {
        parseErrors.push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: $row.text().trim().slice(0, 200),
        });
      }
    });

    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    // Fail-loud: a single forward feed with a 0-event baseline can't rely on the
    // zero-event health alert. Per-run drift (above) + a fully-empty result both
    // surface as errors[] so scrape.ts suppresses stale reconciliation.
    const errors: string[] = parseErrors.map((p) => p.error);
    if (windowed.length === 0) {
      errors.push(
        `Saigon H3: no upcoming runs from ${sourceUrl} ` +
          `(${events.length} parsed, ${rows.length} rows)`,
      );
    }

    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events: windowed,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: windowed.length,
        totalBeforeFilter: events.length,
        fetchDurationMs,
      },
    };
  }
}
