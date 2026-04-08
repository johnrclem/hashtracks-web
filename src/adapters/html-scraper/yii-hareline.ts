import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  decodeEntities,
  fetchHTMLPage,
  MONTHS,
  validateSourceConfig,
} from "../utils";

/**
 * Shared Yii Framework hareline adapter — drives Petaling H3 (ph3.org) and
 * KL Full Moon H3 (klfullmoonhash.com). Both kennels run the same Yii-based
 * GridView template at `/index.php?r=site/hareline` with a single
 * `<table class="table ...">` containing one row per run.
 *
 * **Pagination model:** The Yii GridView defaults to page 1 = *oldest* data
 * (Run 1347 for PH3, 2003). The recurring adapter wants *upcoming* runs,
 * which live on the LAST page. Strategy:
 *   1. Fetch page 1 to discover the max page number from pagination links.
 *   2. Fetch that last page (and optionally the previous page for coverage).
 *
 * **Config shape** (`source.config`):
 * ```ts
 * {
 *   kennelTag: "ph3-my",              // kennelCode — used for all events
 *   startTime: "16:00",               // default HH:MM for all runs (kennel meets)
 *   columnMap?: {                     // 0-indexed column positions; defaults below
 *     runNumber: 0,
 *     date: 1,
 *     hare: 2,
 *     location: 3,
 *     occasion: 4,
 *   },
 *   pagesFromEnd?: number,            // default 2 — how many of the last pages to fetch
 * }
 * ```
 *
 * **Historical backfill:** this adapter parses *one page* at a time. A
 * separate script (`scripts/backfill-ph3-history.ts`) re-uses
 * `parseYiiHarelinePage()` to iterate every page for one-shot historical
 * ingestion, keyed by strict `date < cutoff` partitioning so it never
 * overlaps the recurring adapter's upcoming window.
 */

export interface YiiHarelineConfig {
  kennelTag: string;
  startTime?: string;
  columnMap?: {
    runNumber?: number;
    date?: number;
    hare?: number;
    location?: number;
    occasion?: number;
  };
  pagesFromEnd?: number;
}

const DEFAULT_COLUMN_MAP = {
  runNumber: 0,
  date: 1,
  hare: 2,
  location: 3,
  occasion: 4,
} as const;

/**
 * Parse a Yii hareline date cell like "04 Jan 2003", "21 Feb 2026", or
 * "04-Jan-2003" into "YYYY-MM-DD". Returns null on junk.
 */
export function parseYiiHarelineDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^(\d{1,2})[\s/-]+([A-Za-z]{3,})[\s/-]+(\d{2,4})$/.exec(trimmed);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const month = MONTHS[monthName] ?? MONTHS[monthName.slice(0, 3)];
  if (!month) return null;
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Extract the maximum `page=N` number referenced anywhere in the HTML.
 * Yii pagination always embeds the last-page link so a single fetch of
 * page 1 is enough to discover the total page count. Returns 1 if no
 * pagination links are present (single-page hareline).
 *
 * Exported for unit testing.
 */
export function extractMaxYiiPage(html: string): number {
  let max = 1;
  const re = /[?&]page=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Parse a single Yii hareline table row into a RawEventData. Returns null
 * when the row is a header row, an empty placeholder, or missing the
 * required run-number + date fields.
 *
 * Exported for unit testing.
 */
export function parseYiiHarelineRow(
  cells: string[],
  config: YiiHarelineConfig,
  sourceUrl: string,
): RawEventData | null {
  const cols = { ...DEFAULT_COLUMN_MAP, ...(config.columnMap ?? {}) };

  const runNumCell = cells[cols.runNumber]?.trim();
  const dateCell = cells[cols.date]?.trim();
  if (!runNumCell || !dateCell) return null;

  // Filter placeholder rows where the run number is "0" or "-"
  const runDigits = runNumCell.replace(/\D/g, "");
  if (!runDigits || runDigits === "0") return null;
  const runNumber = Number.parseInt(runDigits, 10);

  const date = parseYiiHarelineDate(dateCell);
  if (!date) return null;

  const rawHare = cells[cols.hare]?.trim() || "";
  // Drop "-hare required-" / "TBA" style placeholders
  const hares = /^-?\s*hare\s*required\s*-?$|^tba?$|^tbc$|^-+$/i.test(rawHare)
    ? undefined
    : rawHare || undefined;

  const location = cells[cols.location]?.trim() || undefined;
  const occasion = cells[cols.occasion]?.trim() || undefined;

  return {
    date,
    kennelTag: config.kennelTag,
    runNumber,
    hares,
    location,
    title: occasion && occasion.length > 0 ? occasion : undefined,
    startTime: config.startTime,
    sourceUrl,
  };
}

/**
 * Parse the events out of a single Yii hareline page HTML blob. The Yii
 * GridView wraps rows in a `<table class="table ...">`; we grab the first
 * such table and iterate its `<tr>` elements.
 *
 * Exported for unit testing + the historical backfill script.
 */
export function parseYiiHarelinePage(
  $: CheerioAPI,
  config: YiiHarelineConfig,
  sourceUrl: string,
): RawEventData[] {
  const events: RawEventData[] = [];
  const table = $("table").first();
  if (!table.length) return events;

  table.find("tr").each((_i, el) => {
    if ($(el).find("th").length > 0) return; // skip header row
    const tds = $(el).find("td").toArray();
    if (tds.length === 0) return;
    const cells = tds.map((td) => decodeEntities($(td).text()).trim());
    const event = parseYiiHarelineRow(cells, config, sourceUrl);
    if (event) events.push(event);
  });

  return events;
}

/**
 * Build the paginated hareline URL for a given base URL + page number.
 * The base URL is expected to be the canonical hareline page
 * (e.g. `https://ph3.org/index.php?r=site/hareline`); we append `&page=N`.
 */
export function buildYiiPageUrl(baseUrl: string, page: number): string {
  if (page <= 1) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}page=${page}`;
}

export class YiiHarelineAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<YiiHarelineConfig>(
      source.config,
      "YiiHarelineAdapter",
      { kennelTag: "string" },
    );
    const baseUrl = source.url;
    if (!baseUrl) {
      return {
        events: [],
        errors: ["YiiHarelineAdapter: source.url is required"],
      };
    }

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Phase 1: fetch page 1 to discover the max page.
    const page1 = await fetchHTMLPage(baseUrl);
    if (!page1.ok) return page1.result;

    const maxPage = extractMaxYiiPage(page1.html);
    const pagesFromEnd = config.pagesFromEnd ?? 2;
    const pagesToFetch = new Set<number>();
    for (let i = 0; i < pagesFromEnd && maxPage - i >= 1; i++) {
      pagesToFetch.add(maxPage - i);
    }
    // page 1 is always useful when it's the only page (no pagination)
    if (maxPage === 1) pagesToFetch.add(1);

    const allEvents: RawEventData[] = [];
    const pagesFetched: number[] = [];

    for (const pageNum of [...pagesToFetch].sort((a, b) => a - b)) {
      // Re-use the already-loaded page 1 HTML when maxPage === 1
      let $: CheerioAPI;
      if (pageNum === 1) {
        $ = cheerio.load(page1.html);
      } else {
        const pageResult = await fetchHTMLPage(buildYiiPageUrl(baseUrl, pageNum));
        if (!pageResult.ok) {
          errors.push(`Yii hareline page ${pageNum} fetch failed`);
          errorDetails.fetch = [
            ...(errorDetails.fetch ?? []),
            ...(pageResult.result.errorDetails?.fetch ?? []),
          ];
          continue;
        }
        $ = pageResult.$;
      }
      const pageEvents = parseYiiHarelinePage($, config, baseUrl);
      allEvents.push(...pageEvents);
      pagesFetched.push(pageNum);
    }

    // Dedupe by (runNumber, date) — adjacent page tails can overlap if the
    // kennel adds a row between the page-1 discovery fetch and the last-page
    // fetch. Runs are unique on (runNumber + date) per Yii schema.
    const seen = new Set<string>();
    const deduped: RawEventData[] = [];
    for (const e of allEvents) {
      const key = `${e.runNumber ?? ""}|${e.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(e);
    }

    const days = options?.days ?? source.scrapeDays ?? 180;
    return applyDateWindow(
      {
        events: deduped,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        structureHash: page1.structureHash,
        diagnosticContext: {
          fetchMethod: "yii-hareline",
          maxPage,
          pagesFetched,
          totalRowsParsed: allEvents.length,
          uniqueEvents: deduped.length,
          fetchDurationMs: page1.fetchDurationMs,
        },
      },
      days,
    );
  }
}
