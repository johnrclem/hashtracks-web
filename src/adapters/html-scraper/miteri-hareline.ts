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
  // Use \u00A0 escape, not a literal NBSP character, to keep ESLint's
  // no-irregular-whitespace happy.
  const collapsed = value.replaceAll("\u00A0", " ").replaceAll(/\s+/g, " ");
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
  opts: { kennelTag: string; referenceDate?: Date; sourceUrl: string; prevDate?: string; forwardDate?: boolean },
): RawEventData | null {
  const dateClean = cleanCellText(row.dateText);
  if (!dateClean) return null;

  // Collapse multi-day ranges ("22-24 May", "22 – 24 May") to the start date.
  // Normalize en-dash / em-dash first so the regex catches all variants.
  const normalizedRange = dateClean.replace(/[–—]/g, "-");
  const rangeMatch = /^(\d+)\s*-\s*\d+\s+(.+)/.exec(normalizedRange);
  const dateToParse = rangeMatch ? `${rangeMatch[1]} ${rangeMatch[2]}` : normalizedRange;

  // forwardDate=false is the table default because the monotonic year-walk in
  // the caller anchors each row from the previous one. For standalone rows
  // (Next Run panel — no chronological neighbour) the caller passes
  // forwardDate=true so a yearless "3 January" parsed on Dec 30 doesn't land
  // in the past and get dropped by the date window. (#1503 year-rollover)
  const parsed = chronoParseDate(
    dateToParse,
    "en-GB",
    opts.referenceDate,
    { forwardDate: opts.forwardDate ?? false },
  );
  if (!parsed) return null;
  const date = bumpYearIfBefore(parsed, opts.prevDate);

  const runClean = cleanCellText(row.runText);
  let runNumber = extractHashRunNumber(row.runText);
  if (runNumber === undefined && runClean) {
    // Number.isFinite(NaN) === false, so non-numeric cells fall through.
    // Use explicit Number.isFinite (not `|| undefined`) so a legitimate
    // run number 0 isn't silently dropped by the falsy check.
    const parsed = Number.parseInt(runClean, 10);
    if (Number.isFinite(parsed)) runNumber = parsed;
  }

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
    const h = (headers.at(i) ?? "").toLowerCase();
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
  const headerRow = rows.at(0);
  if (!headerRow) return [];
  const headerCells = $(headerRow).find("th, td").toArray().map((el) => $(el).text().trim());
  const runIdx = findColumnIndex(headerCells, [/run/i]);
  const dateIdx = findColumnIndex(headerCells, [/date/i]);
  const hareIdx = findColumnIndex(headerCells, [/hare/i]);
  const locIdx = findColumnIndex(headerCells, [/(address|location|venue)/i]);

  // Bail out if essential columns are missing — caller falls back to SiteOrigin.
  if (dateIdx === -1) return [];

  const out: ReturnType<typeof parseGutenbergTable> = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows.at(i);
    if (!row) continue;
    const cells = $(row).find("td, th").toArray().map((el) => $(el).text());
    out.push({
      runText: runIdx >= 0 ? cells.at(runIdx) : undefined,
      dateText: dateIdx >= 0 ? cells.at(dateIdx) : undefined,
      hareText: hareIdx >= 0 ? cells.at(hareIdx) : undefined,
      locationText: locIdx >= 0 ? cells.at(locIdx) : undefined,
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
      runText: runCol.at(i),
      dateText: dateCol.at(i),
      hareText: hareCol.at(i),
      locationText: locCol.at(i),
    });
  }
  return out;
}

/**
 * Parse the "Next Run" panel that some Miteri sites render above the
 * Receding Hareline table (GCH3 layout). The panel is a single tinymce widget
 * with labeled `<p>` rows:
 *
 *   <p><strong>Next Run: # 2356</strong></p>
 *   <p><strong>Date:</strong> <strong>Saturday 23 May</strong></p>
 *   <p><strong>Hare(s):</strong> Small Black</p>
 *   <p><strong>Location:</strong> Historic Hurunui Hotel</p>
 *
 * The panel matters for two reasons:
 *  1. It frequently carries hare + location info that the table downstream
 *     still has as `TBC` / `??` for the same week.
 *  2. Special-event runs (campouts, Saturday socials) sometimes only appear
 *     here and not in the regular Tuesday-cadence table — most prominently
 *     GCH3 #2356 (Sat 23 May, Historic Hurunui Hotel). (#1503)
 *
 * Returns a single row in the same shape as the table parsers, or null when
 * the panel isn't present / can't be parsed.
 */
export function parseNextRunPanel(
  $: cheerio.CheerioAPI,
): { runText?: string; dateText?: string; hareText?: string; locationText?: string } | null {
  let result: ReturnType<typeof parseNextRunPanel> = null;

  $(".textwidget").each((_idx, widget) => {
    if (result) return;
    // Cheap pre-filter — most widgets on the page (welcome blurb, hareline
    // columns, footer) don't contain "Next Run" and shouldn't pay the cost
    // of a per-paragraph regex scan.
    if (!$(widget).text().includes("Next Run")) return;

    const paragraphs = $(widget).find("p").toArray();
    if (paragraphs.length === 0) return;

    let runText: string | undefined;
    let dateText: string | undefined;
    let hareText: string | undefined;
    let locationText: string | undefined;
    let sawNextRun = false;

    for (const p of paragraphs) {
      // `\s` in JS regex covers U+00A0 (NBSP) since ES2018, so tinymce's
      // non-breaking spaces collapse with everything else.
      const text = $(p).text().replace(/\s+/g, " ").trim();
      if (!text) continue;

      // "Next Run: # 2356" — first labeled paragraph identifies the panel.
      const nextRunMatch = /^Next\s+Run\s*:?\s*#?\s*(\d+)/i.exec(text);
      if (nextRunMatch) {
        sawNextRun = true;
        runText = nextRunMatch[1];
        continue;
      }
      if (!sawNextRun) continue;

      const dateMatch = /^Date\s*:\s*(.+)$/i.exec(text);
      if (dateMatch) {
        dateText = dateMatch[1].trim();
        continue;
      }
      const hareMatch = /^Hare(?:\(s\)|s)?\s*:\s*(.+)$/i.exec(text);
      if (hareMatch) {
        hareText = hareMatch[1].trim();
        continue;
      }
      const locMatch = /^Location\s*:\s*(.+)$/i.exec(text);
      if (locMatch) {
        locationText = locMatch[1].trim();
        continue;
      }
    }

    // Require at least Next-Run + Date to consider the panel parsed — the
    // adapter still needs a date to bin the event. Hare/location are optional.
    if (sawNextRun && dateText) {
      result = { runText, dateText, hareText, locationText };
    }
  });

  return result;
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

    // GCH3-style "Next Run" panel sits above the table and is the only place
    // the upcoming run's hare + location appear (the table is still TBC/??
    // for the same row). Some special events (Saturday socials, campouts)
    // also appear ONLY here. Prepend so the chronological year-walk in
    // parseMiteriRow sees it first. (#1503)
    const nextRunRow = parseNextRunPanel($);
    let panelEventsEmitted = 0;
    if (nextRunRow) rows = [nextRunRow, ...rows];

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: NonNullable<ErrorDetails["parse"]> = [];
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);
    // Dedup by `${runNumber}|${date}` so a Next-Run panel row that's also
    // present in the table (when the source eventually fills the hare/location
    // for the same week) doesn't emit twice. Panel rows win because they're
    // processed first and tend to carry the richer fields. Rows without a
    // runNumber are NOT deduped — collapsing same-day entries could drop
    // legitimate paired runs (e.g. a campout weekend with two trails).
    const seenKeys = new Set<string>();

    let prevDate: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows.at(i);
      if (!row) continue;
      const isPanelRow = row === nextRunRow;
      try {
        // Panel rows have no neighbour to anchor the year, so opt into
        // forwardDate to keep a yearless "Saturday 3 January" parsed on
        // Dec 30 from landing in the past. (#1503)
        const event = parseMiteriRow(row, {
          kennelTag,
          sourceUrl,
          prevDate,
          forwardDate: isPanelRow,
        });
        if (!event) continue;
        prevDate = event.date;
        const eventDate = new Date(`${event.date}T12:00:00Z`);
        if (eventDate < minDate || eventDate > maxDate) continue;
        if (event.runNumber !== undefined) {
          const dedupKey = `${event.runNumber}|${event.date}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);
        }
        if (isPanelRow) panelEventsEmitted++;
        events.push(event);
      } catch (err) {
        errors.push(`Row ${i}: ${err}`);
        parseErrors.push({
          row: i,
          section: isPanelRow ? "next-run-panel" : "hareline",
          error: String(err),
        });
      }
    }

    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        layout,
        rowsFound: rows.length,
        eventsParsed: events.length,
        nextRunPanelDetected: nextRunRow !== null,
        nextRunPanelEmitted: panelEventsEmitted,
        fetchDurationMs,
      },
    };
  }
}
