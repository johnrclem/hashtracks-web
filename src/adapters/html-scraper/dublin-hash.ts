/**
 * Dublin Hash House Harriers (DH3) HTML Scraper
 *
 * Scrapes dublinhhh.com/archive for all events (past + future).
 * The archive is a Jekyll-generated HTML table with columns:
 *   Day | Date | Time | Hash (series + run#) | Location | Hares | Notes
 *
 * Several kennels share the table (#2759): Dublin H3, I ♥ Monday (its own
 * even-week series) and Shed Hash. Each row is routed by its Hash label via
 * `Source.config.kennelPatterns` / `defaultKennelTag` (see `routeDublinLabel`);
 * non-trail rows are dropped by the source's `silentlySkipPatterns`.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage, buildDateWindow } from "../utils";
import {
  compileKennelPatterns,
  matchCompiledKennelPatterns,
  type CompiledKennelPattern,
  type KennelPattern,
} from "../kennel-patterns";

/**
 * Strip a trailing 1–2 letter postal-code fragment after a comma
 * (e.g. "Dublin, D" → "Dublin"). #905: also normalize nbsp → space so a
 * trailing `, D\u00A0` (source row wrapping after "Dublin, ") is recognized
 * by the regex's `$` anchor. Multi-digit suffixes like "D02" are real
 * Eircodes and intentionally preserved.
 */
export function stripTruncatedPostalFragment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\u00A0/g, " ").trim();
  const stripped = normalized.replace(/,\s*[A-Z]{1,2}$/i, "").trim();
  return stripped || undefined;
}

const DEFAULT_KENNEL_TAG = "dh3";

/** Per-scrape routing compiled from `Source.config` (#2759). */
export interface DublinRouting {
  patterns: CompiledKennelPattern[];
  defaultTag: string;
}

/** Compile the source's `kennelPatterns` + `defaultKennelTag` once per scrape. */
export function buildDublinRouting(config: unknown): DublinRouting {
  const cfg = (config ?? {}) as { kennelPatterns?: KennelPattern[]; defaultKennelTag?: string };
  return {
    patterns: compileKennelPatterns(cfg.kennelPatterns ?? []),
    defaultTag: cfg.defaultKennelTag ?? DEFAULT_KENNEL_TAG,
  };
}

/**
 * Route a hareline row to a kennelCode by its Hash label (column 3) — the
 * site's own `hash` / `other_hash` field: "Dublin H3", "I ♥ Monday", or an
 * "Other" hash's free-text name. Unmatched labels go to the default kennel.
 *
 * The detail-page slug (`…-dublin-h3/`, `…-i-♥-monday/`, `…-other/`) is NOT a
 * reliable signal: it is fixed when the post is created (the 2025 Wren Boys run
 * lives under an `i-♥-monday` slug; one DH3 slug reads "dubiln").
 */
export function routeDublinLabel(label: string, routing: DublinRouting): string {
  return matchCompiledKennelPatterns(label, routing.patterns)[0] ?? routing.defaultTag;
}

/**
 * Parse a single table row into a RawEventData, filed under `kennelTag`
 * (routed by the caller via `routeDublinLabel`).
 * Exported for unit testing.
 */
export function parseHarelineRow(
  cells: string[],
  hrefs: (string | undefined)[],
  sourceUrl: string,
  kennelTag: string = DEFAULT_KENNEL_TAG,
): RawEventData | null {
  // Expected columns: [0]=day, [1]=date, [2]=time, [3]=hash, [4]=location, [5]=hares, [6]=notes
  if (cells.length < 6) return null;

  const dateText = cells[1]?.trim() ?? "";
  if (!dateText) return null;

  // Handle date ranges like "3–5 July 2026" — take the first date
  const normalizedDate = dateText.replace(/\u2013/g, "-").replace(/&ndash;/g, "-");
  const rangeMatch = normalizedDate.match(/^(\d+)\s*-\s*\d+\s+(.+)/);
  const dateToParse = rangeMatch ? `${rangeMatch[1]} ${rangeMatch[2]}` : normalizedDate;

  const date = chronoParseDate(dateToParse, "en-GB");
  if (!date) return null;

  // Time (24h format like "19:30")
  const timeText = cells[2]?.trim();
  let startTime: string | undefined;
  if (timeText && /^\d{1,2}:\d{2}$/.test(timeText)) {
    const [h, m] = timeText.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      startTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
  }

  // Hash name + run number from column 3: "Dublin H3 #1668" or "I ♥ Monday #410"
  const hashText = cells[3]?.trim() ?? "";
  const runMatch = hashText.match(/#(\d+)/);
  const runNumber = runMatch ? parseInt(runMatch[1], 10) : undefined;

  // Build title from hash text, cleaning up whitespace
  const title = hashText.replace(/\s+/g, " ").trim() || undefined;

  // Location text + Google Maps URL.
  // Some archive rows leak a truncated Dublin postal-code fragment (e.g. ", D")
  // because the source cell wraps after "Dublin, " — trim trailing 1–2 letter
  // fragments that follow a comma so we don't store ", D" as part of the location.
  const location = stripTruncatedPostalFragment(cells[4]?.trim() || undefined);
  const locationUrl = hrefs[4] || undefined;

  // Hares
  const haresText = cells[5]?.trim();
  const hares = haresText && !/^tbd$/i.test(haresText) ? haresText : undefined;

  // Source URL from detail page link
  const detailHref = hrefs[3];
  const eventSourceUrl = detailHref
    ? new URL(detailHref, sourceUrl).href
    : sourceUrl;

  // Notes (on-on venue) in column 6
  const notes = cells[6]?.trim() || undefined;
  const description = notes || undefined;

  return {
    date,
    kennelTags: [kennelTag],
    title,
    hares,
    location,
    locationUrl,
    startTime,
    runNumber,
    sourceUrl: eventSourceUrl,
    description,
  };
}

export class DublinHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://dublinhhh.com/archive";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const rows = $("table tr");
    const routing = buildDublinRouting(source.config);

    rows.each((i, el) => {
      const $row = $(el);
      // Skip header row (has <th> elements)
      if ($row.find("th").length > 0) return;

      try {
        const cells: string[] = [];
        const hrefs: (string | undefined)[] = [];

        $row.find("td").each((_j, td) => {
          const $td = $(td);
          // Replace <br> with space for clean text
          $td.find("br").replaceWith(" ");
          cells.push($td.text().trim());
          // Extract first <a> href if present
          const href = $td.find("a").first().attr("href");
          hrefs.push(href || undefined);
        });

        const kennelTag = routeDublinLabel(cells[3] ?? "", routing);
        const event = parseHarelineRow(cells, hrefs, sourceUrl, kennelTag);
        if (event) {
          // Filter by date window (archive page has all historical events)
          const eventDate = new Date(event.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) return;
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: $row.text().trim().slice(0, 2000),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
