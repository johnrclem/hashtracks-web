/**
 * DFW Hash House Harriers Calendar Adapter
 *
 * Scrapes dfwhhh.org/calendar/ — a PHP-generated "Martha's Calendar Generator"
 * table-grid calendar covering 5 DFW-area kennels. The page uses:
 *   - <table class="main"> with <th> day-of-week headers (Sunday–Saturday)
 *   - Each day cell (<td class="day">) nests a <table class="inner"> with:
 *     - <td class="dom">N</td> or <td class="holiday"><span class="tag">Label</span>N</td>
 *     - <td class="event"> containing <img> icons, titles, and <em> hare names
 *   - Multi-event days link to multi.php instead of event.php
 *   - Detail pages (event.php?month=M&day=D&year=Y&no=1) have time, location, etc.
 *
 * URL pattern: http://www.dfwhhh.org/calendar/YYYY/$MM-YYYY.php
 * HTTP-only (expired SSL) — uses safeFetch which handles HTTP.
 *
 * Scrapes current month + next month, then enriches with detail page data.
 */
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { parse12HourTime } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";
import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Icon filename → kennelCode mapping.
 * Values are immutable kennelCodes (not shortNames) for stable resolution.
 * The <img> src attribute ends with one of these filenames.
 */
export const ICON_TO_KENNEL: Record<string, string> = {
  "dallas.png": "dh3-tx",
  "DUH.png": "duhhh",
  "NoDHHH2.png": "noduhhh",
  "ftworth.png": "fwh3",
  "YAKH3.png": "yakh3",
};

/** Base URL for resolving relative detail page links. */
const DFW_BASE_URL = "http://www.dfwhhh.org/calendar";

/**
 * Build the URL for a given month's calendar page.
 * Format: http://www.dfwhhh.org/calendar/YYYY/$MM-YYYY.php
 */
export function buildDFWMonthUrl(year: number, month: number): string {
  const mm = String(month + 1).padStart(2, "0"); // month is 0-indexed
  return `http://www.dfwhhh.org/calendar/${year}/$${mm}-${year}.php`;
}

/** Event with optional detail page URL for enrichment. */
interface DFWEventWithDetail {
  event: RawEventData;
  detailUrl?: string;
}

/**
 * Extract the day number from a calendar cell's inner table.
 *
 * The DFW calendar nests a <table class="inner"> inside each <td class="day">:
 *   - Normal days: <td class="dom">N</td>
 *   - Holiday days: <td class="holiday"><span class="tag">Label</span>N</td>
 *
 * Falls back to scanning for the first standalone number in cell text.
 */
function extractDayNumber($cell: Cheerio<AnyNode>, _$: CheerioAPI): number | undefined {
  const domCell = $cell.find("td.dom, td.holiday");
  if (domCell.length > 0) {
    const domText = domCell.text().trim();
    const domMatch = domText.match(/(\d{1,2})/);
    if (domMatch) {
      const day = parseInt(domMatch[1], 10);
      if (day >= 1 && day <= 31) return day;
    }
  }

  // Fallback: scan for first 1-2 digit number in cell text
  const cellText = $cell.text().trim();
  const dayMatch = cellText.match(/\b(\d{1,2})\b/);
  if (dayMatch) {
    const day = parseInt(dayMatch[1], 10);
    if (day >= 1 && day <= 31) return day;
  }

  return undefined;
}

/**
 * Extract events from a single month's calendar HTML.
 * @param $ - Cheerio instance loaded with the page HTML
 * @param year - Calendar year
 * @param month - Calendar month (0-indexed)
 * @param sourceUrl - URL of the page (for sourceUrl field)
 * @returns Array of parsed events (with detail URLs) and any errors
 */
export function extractDFWEvents(
  $: CheerioAPI,
  year: number,
  month: number,
  sourceUrl: string,
): { events: DFWEventWithDetail[]; errors: string[]; errorDetails: ErrorDetails } {
  const events: DFWEventWithDetail[] = [];
  const errors: string[] = [];
  const errorDetails: ErrorDetails = {};

  // Find the main calendar table — look for table with day-of-week headers
  const tables = $("table");
  if (tables.length === 0) {
    errors.push("No table found on page");
    return { events, errors, errorDetails };
  }

  let calendarTable: Cheerio<AnyNode> | null = null;
  tables.each((_i, table) => {
    const firstRowText = $(table).find("tr").first().text().toLowerCase();
    if (
      firstRowText.includes("sun") &&
      firstRowText.includes("mon") &&
      firstRowText.includes("tue")
    ) {
      calendarTable = $(table);
      return false;
    }
  });

  if (!calendarTable) {
    errors.push("No calendar table found (missing day-of-week headers)");
    return { events, errors, errorDetails };
  }

  // Process each day cell (skip header row, skip inner nested tables)
  const dayCells = (calendarTable as Cheerio<AnyNode>).find("> tbody > tr > td.day, > tr > td.day");

  // If no td.day cells found, fall back to legacy row-based parsing
  const cells = dayCells.length > 0
    ? dayCells
    : (calendarTable as Cheerio<AnyNode>).find("> tbody > tr > td, > tr > td").not("th");

  cells.each((_j, cell) => {
    const $cell = $(cell);

    try {
      const day = extractDayNumber($cell, $);
      if (day === undefined) return;

      // Find the event content area (prefer td.event inside nested table)
      const $eventCell = $cell.find("td.event");
      const $content = $eventCell.length > 0 ? $eventCell : $cell;

      const imgs = $content.find("img");
      if (imgs.length === 0) return;

      const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
      const dateStr = date.toISOString().split("T")[0];

      let detailUrl: string | undefined;
      const eventLink = $content.find('a[href*="event.php"]').first();
      if (eventLink.length > 0) {
        const href = eventLink.attr("href") ?? "";
        detailUrl = href.startsWith("http") ? href : `${DFW_BASE_URL}/${year}/${href}`;
      }

      const multiLink = $content.find('a[href*="multi.php"]').first();
      const isMultiEvent = multiLink.length > 0;

      imgs.each((_k, img) => {
        const src = $(img).attr("src") || "";
        // Match icon filename from the end of the src path
        let kennelTag: string | undefined;
        for (const [icon, tag] of Object.entries(ICON_TO_KENNEL)) {
          if (src.endsWith(icon)) {
            kennelTag = tag;
            break;
          }
        }
        if (!kennelTag) return;

        // Extract hares from <em> tags within the event content
        const emTexts: string[] = [];
        $content.find("em").each((_m, em) => {
          const t = $(em).text().trim();
          if (t) emTexts.push(t);
        });
        const hares = emTexts.length > 0 ? emTexts.join(", ") : undefined;

        // Extract title from event content HTML
        const contentHtml = $content.html() ?? "";
        const titleHtml = contentHtml
          .replace(/<em[^>]*>.*?<\/em>/gi, "")
          .replace(/<img[^>]*\/?>/gi, "")
          .replace(/<a[^>]*>.*?<\/a>/gi, "")
          .replace(/<br\s*\/?>/gi, " ");
        let title = titleHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        // Remove leading day number and trailing/leading punctuation
        title = title.replace(/^\d{1,2}\s*/, "").trim();
        title = title.replace(/^[,\-–\s]+|[,\-–\s]+$/g, "").trim();
        // Remove multi-event placeholder text
        title = title.replace(/\d+ Events? Today/i, "").trim();

        // For multi-event days, construct per-event detail URL
        let eventDetailUrl = detailUrl;
        if (isMultiEvent && !detailUrl) {
          // Multi-event days: each event has its own event.php?...&no=N link
          const perEventLink = $(img).closest("a").attr("href") ?? "";
          if (perEventLink.includes("event.php")) {
            eventDetailUrl = perEventLink.startsWith("http")
              ? perEventLink
              : `${DFW_BASE_URL}/${year}/${perEventLink}`;
          }
        }

        const event: RawEventData = {
          date: dateStr,
          kennelTag,
          sourceUrl,
          ...(title && { title }),
          ...(hares && { hares }),
        };

        events.push({ event, detailUrl: eventDetailUrl });
      });
    } catch (err) {
      errors.push(`Error parsing cell: ${err}`);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row: _j, section: "calendar", error: String(err) },
      ];
    }
  });

  return { events, errors, errorDetails };
}

/**
 * Patterns that indicate the heading is a kennel name, not a venue.
 * Case-insensitive matching.
 */
const KENNEL_NAME_PATTERNS = [
  /hash/i,
  /\bh3\b/i,
  /\bh4\b/i,
  /\bhhh\b/i,
  /\bdallas\b/i,
  /\bduh\b/i,
  /\bnoduh\b/i,
  /\bfort worth\b/i,
  /\bdfw\b/i,
  /\byak\b/i,
];

/** Day-of-week prefix pattern (detail pages sometimes have date headings). */
const DAY_PREFIX_PATTERN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i;

/**
 * Extract a venue name from the detail page headings.
 *
 * Looks at <h2> text (skipping date-like headings), then falls back to <h1>.
 * Filters out kennel names and empty/whitespace strings.
 */
function extractVenueName($: CheerioAPI): string | undefined {
  // Collect candidate headings: all <h2> then <h1>
  const candidates: string[] = [];
  $("h2").each((_i, el) => {
    candidates.push($(el).text().trim());
  });
  $("h1").each((_i, el) => {
    candidates.push($(el).text().trim());
  });

  for (const text of candidates) {
    if (!text) continue;
    // Skip date-like headings (e.g. "Monday, March 23, 2026")
    if (DAY_PREFIX_PATTERN.test(text)) continue;
    // Skip kennel name headings
    if (KENNEL_NAME_PATTERNS.some((p) => p.test(text))) continue;
    // Skip run number headings
    if (/Hash Run No/i.test(text)) continue;
    return text;
  }

  return undefined;
}

/**
 * Parse a DFW event detail page for time, location, and other fields.
 *
 * Detail pages use <h5><em>Label:</em> Value</h5> format:
 *   - Time: "7:00 PM"
 *   - Start address: "Sam Houston Trail Park, Irving"
 *   - Hares: "Casting Cooch"
 *   - Hash Run No NNN (in <h3>)
 */
export function parseDFWDetailPage($: CheerioAPI): {
  startTime?: string;
  location?: string;
  hares?: string;
  runNumber?: number;
} {
  const result: {
    startTime?: string;
    location?: string;
    hares?: string;
    runNumber?: number;
  } = {};

  // Extract fields from <h5><em>Label:</em> Value</h5> pattern
  $("h5").each((_i, h5) => {
    const $h5 = $(h5);
    const label = $h5.find("em").first().text().trim().toLowerCase();
    const $h5Clone = $h5.clone();
    $h5Clone.find("em").remove();
    const value = $h5Clone.text().replace(/^:/, "").trim();

    if (!value || value.toLowerCase() === "nothing yet") return;

    if (label.startsWith("time:")) {
      result.startTime = parse12HourTime(value);
    } else if (label.startsWith("start address:")) {
      result.location = value;
    } else if (label.startsWith("hares:") || label.startsWith("hare:")) {
      result.hares = value;
    }
  });

  const h3Text = $("h3").first().text().trim();
  const runMatch = h3Text.match(/Hash Run No\s*(\d+)/i);
  if (runMatch) {
    result.runNumber = parseInt(runMatch[1], 10);
  }

  // Extract venue name from <h2> heading and prepend to location
  if (result.location) {
    const venueName = extractVenueName($);
    if (venueName) {
      result.location = `${venueName}, ${result.location}`;
    }
  }

  return result;
}

/** Concurrency limit for detail page fetches. */
const DETAIL_CONCURRENCY = 3;
/** Delay between batches of detail page fetches (ms). */
const DETAIL_BATCH_DELAY = 300;

const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";

/**
 * DFW Hash House Harriers Calendar Adapter
 *
 * Scrapes current month + next month from the PHP calendar at dfwhhh.org,
 * then enriches events with time/location from individual detail pages.
 */
export class DFWHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    _source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const now = new Date();
    const currentMonth = now.getUTCMonth();
    const currentYear = now.getUTCFullYear();

    // Next month (handles year rollover)
    const nextMonth = (currentMonth + 1) % 12;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;

    const months = [
      { year: currentYear, month: currentMonth },
      { year: nextYear, month: nextMonth },
    ];

    const fetchStart = Date.now();

    // Fetch both months concurrently
    const results = await Promise.allSettled(
      months.map(async ({ year, month }) => {
        const url = buildDFWMonthUrl(year, month);
        const response = await safeFetch(url, {
          headers: { "User-Agent": USER_AGENT },
        });
        return { response, url, year, month };
      }),
    );

    const allEventsWithDetail: DFWEventWithDetail[] = [];
    const allErrors: string[] = [];
    const allErrorDetails: ErrorDetails = {};
    let structureHash: string | undefined;

    for (const result of results) {
      if (result.status === "rejected") {
        const message = `Fetch failed: ${result.reason}`;
        allErrors.push(message);
        allErrorDetails.fetch = [...(allErrorDetails.fetch ?? []), { url: "", message }];
        continue;
      }

      const { response, url, year, month } = result.value;

      if (!response.ok) {
        const message = `HTTP ${response.status} for ${url}`;
        allErrors.push(message);
        allErrorDetails.fetch = [...(allErrorDetails.fetch ?? []), { url, status: response.status, message }];
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      if (!structureHash) {
        structureHash = generateStructureHash(html);
      }

      const { events, errors, errorDetails } = extractDFWEvents($, year, month, url);
      allEventsWithDetail.push(...events);
      allErrors.push(...errors);

      if (errorDetails.parse?.length) {
        allErrorDetails.parse = [...(allErrorDetails.parse ?? []), ...errorDetails.parse];
      }
    }

    // Enrichment pass — fetch detail pages for time/location
    const eventsWithUrls = allEventsWithDetail.filter((e) => e.detailUrl);
    let detailFetched = 0;
    let detailFailed = 0;

    for (let i = 0; i < eventsWithUrls.length; i += DETAIL_CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, DETAIL_BATCH_DELAY));

      const batch = eventsWithUrls.slice(i, i + DETAIL_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async ({ detailUrl }) => {
          const resp = await safeFetch(detailUrl!, {
            headers: { "User-Agent": USER_AGENT },
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return { detailUrl, html: await resp.text() };
        }),
      );

      for (let b = 0; b < batchResults.length; b++) {
        const batchResult = batchResults[b];
        if (batchResult.status === "fulfilled") {
          const { html } = batchResult.value;
          const $detail = cheerio.load(html);
          const detail = parseDFWDetailPage($detail);
          const evt = batch[b].event;

          if (detail.startTime) evt.startTime = detail.startTime;
          if (detail.location) evt.location = detail.location;
          if (detail.runNumber) evt.runNumber = detail.runNumber;
          if (detail.hares && !evt.hares) evt.hares = detail.hares;

          detailFetched++;
        } else {
          detailFailed++;
        }
      }
    }

    const allEvents = allEventsWithDetail.map((e) => e.event);

    return {
      events: allEvents,
      errors: allErrors,
      structureHash,
      errorDetails: hasAnyErrors(allErrorDetails) ? allErrorDetails : undefined,
      diagnosticContext: {
        monthsFetched: months.length,
        eventsParsed: allEvents.length,
        detailPagesFetched: detailFetched,
        detailPagesFailed: detailFailed,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
