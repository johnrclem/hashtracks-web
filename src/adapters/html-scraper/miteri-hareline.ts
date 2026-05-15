import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  bumpYearIfBefore,
  chronoParseDate,
  extractHashRunNumber,
  fetchHTMLPage,
  normalizeHaresField,
  stripPlaceholder,
} from "../utils";

/**
 * Miteri-Hareline adapter — shared parser for NZ kennels running ThemeEgg's
 * Miteri WordPress theme with a homepage "Receding Hareline" section.
 *
 * Two layouts in the wild:
 *   1. SiteOrigin Page Builder (Garden City H3) — 4 panel-grid cells, each
 *      a tinymce widget with `<p><strong>Run:</strong></p>` header + `<p>`
 *      data rows. Empty cells render as `<p>&nbsp;</p>`.
 *   2. Gutenberg wp-block-table (Christchurch H3) — `<figure class="wp-block-table">`
 *      wrapping a single `<table>` with a header row (`<strong>Run #</strong>`
 *      / Date: / Hare: / Address:) followed by body rows.
 *
 * Both share the same column semantics: Run #, Date, Hares, Location.
 * Dates are short-form (e.g. "26 May", "22-24 May") with year inferred from
 * scrape time; multi-day ranges collapse to the start date and produce a
 * single event (campouts / weekend-aways).
 *
 * Placeholders (`??`, `TBC`, `TBA`, blank) leave the affected field as
 * `undefined` so the merge pipeline's atomic-bundle semantics preserve
 * previously stored values rather than clearing them.
 */

/** Trim + collapse whitespace + drop common placeholders. */
function cleanCellText(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  // Normalize U+00A0 (&nbsp;) → space before collapsing runs of whitespace.
  const collapsed = value.replace(/ /g, " ").replace(/\s+/g, " ");
  return stripPlaceholder(collapsed);
}

/**
 * Parse a single Miteri hareline row into a RawEventData.
 * Returns null when the date can't be parsed (empty cell, placeholder, or
 * unrecognized format).
 *
 * Year inference uses refDate-year by default; the adapter performs a
 * monotonic-walk year bump across the chronologically-sorted hareline, so
 * `prevDate` is supplied when a previous row already locked in a year.
 */
export function parseMiteriRow(
  row: { runText?: string; dateText?: string; hareText?: string; locationText?: string },
  opts: { kennelTag: string; referenceDate?: Date; sourceUrl: string; prevDate?: string },
): RawEventData | null {
  const dateClean = cleanCellText(row.dateText);
  if (!dateClean) return null;

  // Collapse multi-day ranges ("22-24 May", "22 – 24 May") to the start date.
  // Normalize en-dash / em-dash first so the regex catches all variants.
  const normalizedRange = dateClean.replace(/[–—]/g, "-");
  const rangeMatch = /^(\d+)\s*-\s*\d+\s+(.+)/.exec(normalizedRange);
  const dateToParse = rangeMatch ? `${rangeMatch[1]} ${rangeMatch[2]}` : normalizedRange;

  const parsed = chronoParseDate(
    dateToParse,
    "en-GB",
    opts.referenceDate,
    { forwardDate: false },
  );
  if (!parsed) return null;
  const date = bumpYearIfBefore(parsed, opts.prevDate);

  const runClean = cleanCellText(row.runText);
  const runNumber =
    extractHashRunNumber(row.runText)
    ?? (runClean ? Number.parseInt(runClean, 10) || undefined : undefined);

  const hares = normalizeHaresField(cleanCellText(row.hareText));
  const location = cleanCellText(row.locationText);

  return {
    date,
    kennelTags: [opts.kennelTag],
    runNumber,
    hares,
    location,
    sourceUrl: opts.sourceUrl,
  };
}

/**
 * Detect column index by header text inside a `<th>` or first-row `<td>`.
 * Returns -1 if no header matches.
 */
function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

/**
 * Parse the Gutenberg wp-block-table layout (CHH3 shape).
 * Returns the parsed rows; caller filters/converts to RawEventData.
 */
export function parseGutenbergTable(
  $: cheerio.CheerioAPI,
): Array<{ runText?: string; dateText?: string; hareText?: string; locationText?: string }> {
  const $table = $('figure.wp-block-table table').first();
  if ($table.length === 0) return [];

  const rows = $table.find("tr").toArray();
  if (rows.length === 0) return [];

  // Header row = first row with bold cells (covers `<th>` or `<td><strong>`).
  const headerCells = $(rows[0]).find("th, td").toArray().map((el) => $(el).text().trim());
  const runIdx = findColumnIndex(headerCells, [/run/i]);
  const dateIdx = findColumnIndex(headerCells, [/date/i]);
  const hareIdx = findColumnIndex(headerCells, [/hare/i]);
  const locIdx = findColumnIndex(headerCells, [/(address|location|venue)/i]);

  // Bail out if essential columns are missing — caller falls back to SiteOrigin.
  if (dateIdx === -1) return [];

  const out: ReturnType<typeof parseGutenbergTable> = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = $(rows[i]).find("td, th").toArray().map((el) => $(el).text());
    out.push({
      runText: runIdx >= 0 ? cells[runIdx] : undefined,
      dateText: dateIdx >= 0 ? cells[dateIdx] : undefined,
      hareText: hareIdx >= 0 ? cells[hareIdx] : undefined,
      locationText: locIdx >= 0 ? cells[locIdx] : undefined,
    });
  }
  return out;
}

/**
 * Parse the SiteOrigin Page Builder layout (GCH3 shape).
 *
 * The hareline lives inside a `.panel-grid` row containing 4 `.panel-grid-cell`
 * widgets; each cell's first `<p><strong>...</strong></p>` is its header, and
 * the subsequent `<p>` siblings are the data rows. The four cells are zipped
 * into row tuples.
 *
 * Robust to layout drift: we identify cells by header label, not position.
 */
export function parseSiteOriginGrid(
  $: cheerio.CheerioAPI,
): Array<{ runText?: string; dateText?: string; hareText?: string; locationText?: string }> {
  // Find the panel-grid row whose cells include both "Run" and "Date" headers.
  // This avoids accidentally matching unrelated multi-column panels.
  let runCol: string[] = [];
  let dateCol: string[] = [];
  let hareCol: string[] = [];
  let locCol: string[] = [];

  $(".panel-grid").each((_idx, grid) => {
    const cells = $(grid).find(".panel-grid-cell");
    if (cells.length < 2) return;

    const columns: { header: string; values: string[] }[] = [];
    cells.each((_j, cell) => {
      const paragraphs = $(cell).find(".textwidget > p").toArray();
      if (paragraphs.length === 0) return;
      const header = $(paragraphs[0]).find("strong").first().text().trim();
      if (!header) return;
      const values = paragraphs.slice(1).map((p) => $(p).text());
      columns.push({ header, values });
    });

    // Need at least Run + Date in the same row to consider it the hareline.
    const lowered = columns.map((c) => c.header.toLowerCase());
    const hasRun = lowered.some((h) => h.startsWith("run"));
    const hasDate = lowered.some((h) => h.startsWith("date"));
    if (!hasRun || !hasDate) return;

    for (const col of columns) {
      const h = col.header.toLowerCase();
      if (h.startsWith("run")) runCol = col.values;
      else if (h.startsWith("date")) dateCol = col.values;
      else if (h.startsWith("hare")) hareCol = col.values;
      else if (h.startsWith("location") || h.startsWith("address") || h.startsWith("venue")) locCol = col.values;
    }
  });

  const length = Math.max(runCol.length, dateCol.length, hareCol.length, locCol.length);
  const out: ReturnType<typeof parseSiteOriginGrid> = [];
  for (let i = 0; i < length; i++) {
    out.push({
      runText: runCol[i],
      dateText: dateCol[i],
      hareText: hareCol[i],
      locationText: locCol[i],
    });
  }
  return out;
}

export interface MiteriHarelineConfig {
  kennelTag: string;
}

function isMiteriConfig(cfg: unknown): cfg is MiteriHarelineConfig {
  return typeof cfg === "object" && cfg !== null && typeof (cfg as { kennelTag?: unknown }).kennelTag === "string";
}

export class MiteriHarelineAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url;
    if (!sourceUrl) {
      return {
        events: [],
        errors: ["Missing source.url"],
        errorDetails: { fetch: [{ message: "Missing source.url" }] },
      };
    }

    if (!isMiteriConfig(source.config)) {
      return {
        events: [],
        errors: ["MiteriHarelineAdapter requires config.kennelTag"],
        errorDetails: { fetch: [{ url: sourceUrl, message: "Missing kennelTag in source.config" }] },
      };
    }
    const { kennelTag } = source.config;

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    // Try Gutenberg table first (CHH3 shape); fall back to SiteOrigin grid (GCH3).
    let rows = parseGutenbergTable($);
    let layout: "gutenberg" | "siteorigin" = "gutenberg";
    if (rows.length === 0) {
      rows = parseSiteOriginGrid($);
      layout = "siteorigin";
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    let prevDate: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      try {
        const event = parseMiteriRow(rows[i], { kennelTag, sourceUrl, prevDate });
        if (!event) continue;
        prevDate = event.date;
        const eventDate = new Date(`${event.date}T12:00:00Z`);
        if (eventDate < minDate || eventDate > maxDate) continue;
        events.push(event);
      } catch (err) {
        errors.push(`Row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          section: "hareline",
          error: String(err),
        });
      }
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        layout,
        rowsFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
