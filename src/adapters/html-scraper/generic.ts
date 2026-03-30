/**
 * Generic HTML Scraper Adapter
 *
 * Config-driven HTML event extraction using CSS selectors.
 * Eliminates the need for custom adapter code per hash site.
 *
 * Config shape is stored in Source.config as JSON. The registry routes
 * HTML_SCRAPER sources here when config has containerSelector + rowSelector.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  chronoParseDate,
  fetchHTMLPage,
  parse12HourTime,
  validateSourceConfig,
  type DateLocale,
} from "../utils";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/** Column selectors for extracting event fields from each row. */
export interface GenericHtmlColumns {
  date: string;             // required — CSS selector (e.g., "td:nth-child(2)")
  kennelTag?: string;
  title?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;     // extracts href from <a>
  startTime?: string;
  runNumber?: string;
  sourceUrl?: string;       // extracts href from <a>
}

/** Config shape stored in Source.config for generic HTML sources. */
export interface GenericHtmlConfig {
  containerSelector: string;  // CSS selector for the event container
  rowSelector: string;        // CSS selector for each row within container
  columns: GenericHtmlColumns;
  defaultKennelTag: string;
  dateLocale?: DateLocale;    // "en-US" | "en-GB" — defaults to "en-US"
  locationTruncateAfter?: "uk-postcode";  // truncate location at first UK postcode match
  defaultStartTime?: string;               // "HH:MM" fallback when page doesn't have per-event times
  forwardDate?: boolean;                   // resolve year-less dates to next future occurrence
  maxPastDays?: number;                    // skip events with dates more than N days in the past
  stopWhenRunNumberDecreases?: boolean;    // stop parsing when run number drops (e.g., Cape Fear receding hareline)
}

/** Type guard: does this config look like a GenericHtmlConfig? */
export function isGenericHtmlConfig(
  config: unknown,
): boolean {
  if (!config || typeof config !== "object") return false;
  const obj = config as Record<string, unknown>;
  return (
    typeof obj.containerSelector === "string" &&
    typeof obj.rowSelector === "string" &&
    typeof obj.columns === "object" &&
    obj.columns !== null &&
    !Array.isArray(obj.columns)
  );
}

/**
 * Extract text content from a row element using a CSS selector.
 * Returns trimmed text, or undefined if empty/not found.
 */
function extractText(
  $: CheerioAPI,
  $row: Cheerio<AnyNode>,
  selector: string | undefined,
): string | undefined {
  if (!selector) return undefined;
  const text = $row.find(selector).text().trim();
  return text || undefined;
}

/**
 * Extract href attribute from the first matching <a> within a row element.
 * Returns the href string, or undefined if not found.
 */
function extractHref(
  $: CheerioAPI,
  $row: Cheerio<AnyNode>,
  selector: string | undefined,
): string | undefined {
  if (!selector) return undefined;
  const el = $row.find(selector);
  // If the selector points to an <a>, use its href; otherwise find <a> within
  const href = el.is("a") ? el.attr("href") : el.find("a").first().attr("href");
  return href || undefined;
}

/** Filters CTA/placeholder values from hares column (e.g., "Sign Up!", "TBD", "Volunteer"). */
const CTA_HARES_RE = /^(?:tbd|tba|tbc|n\/a|sign[\s\u00A0]*up!?|volunteer|needed|required)$/i;

/** UK postcode pattern for location truncation. */
const UK_POSTCODE_RE = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i;

/**
 * Parse a single row element into RawEventData using the column config.
 * Exported for unit testing.
 */
export function parseEventRow(
  $: CheerioAPI,
  $row: Cheerio<AnyNode>,
  config: GenericHtmlConfig,
  sourceUrl: string,
): RawEventData | null {
  const { columns, defaultKennelTag, dateLocale = "en-US" } = config;

  // Date is required
  const dateText = extractText($, $row, columns.date);
  if (!dateText) return null;

  const date = chronoParseDate(dateText, dateLocale, undefined, { forwardDate: config.forwardDate });
  if (!date) return null;

  // Extract optional fields
  const kennelTag = extractText($, $row, columns.kennelTag) || defaultKennelTag;
  const title = extractText($, $row, columns.title);
  const rawHares = extractText($, $row, columns.hares);
  const hares = rawHares && !CTA_HARES_RE.test(rawHares) ? rawHares : undefined;
  let location = extractText($, $row, columns.location);
  // UK postcode truncation: strip driving directions after postcode
  if (config.locationTruncateAfter === "uk-postcode" && location) {
    const postcodeMatch = UK_POSTCODE_RE.exec(location);
    if (postcodeMatch) {
      location = location.slice(0, postcodeMatch.index! + postcodeMatch[0].length).trim();
    }
  }
  const locationUrl = extractHref($, $row, columns.locationUrl) ?? extractHref($, $row, columns.location);
  const sourceEventUrl = extractHref($, $row, columns.sourceUrl);

  // Run number: extract digits
  const runNumberText = extractText($, $row, columns.runNumber);
  const runDigits = runNumberText?.replaceAll(/\D/g, "");
  let runNumber: number | undefined;
  if (runDigits) {
    const parsed = Number.parseInt(runDigits, 10);
    // Sanity cap: real hash run numbers are < 100000; larger values are
    // date strings or other text that leaked into the run-number column
    runNumber = parsed > 0 && parsed < 100000 ? parsed : undefined;
  }

  // Start time: try to extract from dedicated field, or parse from date text
  let startTime: string | undefined;
  const timeText = extractText($, $row, columns.startTime);
  if (timeText) {
    startTime = parse12HourTime(timeText);
    if (!startTime && /^\d{2}:\d{2}$/.test(timeText)) {
      const [h, m] = timeText.split(":").map(Number);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        startTime = timeText;
      }
    }
  }
  // Fall back to config default when no per-event time extracted
  if (!startTime && config.defaultStartTime) {
    startTime = config.defaultStartTime;
  }

  return {
    date,
    kennelTag,
    title,
    hares,
    location,
    locationUrl,
    startTime,
    runNumber,
    sourceUrl: sourceEventUrl || sourceUrl,
  };
}

/**
 * Generic HTML Scraper — config-driven event extraction.
 *
 * Uses CSS selectors from Source.config to find event containers,
 * iterate rows, and extract fields. No custom code per site.
 */
export class GenericHtmlAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<GenericHtmlConfig>(
      source.config,
      "GenericHtmlAdapter",
      {
        containerSelector: "string",
        rowSelector: "string",
        columns: "object",
      },
    );

    const sourceUrl = source.url || "";
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Find rows within container
    const container = $(config.containerSelector);
    const rows = container.length > 0
      ? container.find(config.rowSelector)
      : $(config.rowSelector); // fallback: try rowSelector directly

    // Pre-compute past-date cutoff if maxPastDays is configured
    const pastCutoff = config.maxPastDays != null
      ? new Date(Date.now() - config.maxPastDays * 86_400_000).toISOString().split("T")[0]
      : undefined;

    let lastRunNumber: number | undefined;
    let stopParsing = false;

    rows.each((i, el) => {
      if (stopParsing) return;
      try {
        const event = parseEventRow($, $(el), config, sourceUrl);
        if (event) {
          // Skip events too far in the past
          if (pastCutoff && event.date < pastCutoff) return;
          // Stop when run numbers decrease (e.g., Cape Fear receding hareline)
          if (config.stopWhenRunNumberDecreases && event.runNumber != null) {
            if (lastRunNumber != null && event.runNumber < lastRunNumber) {
              stopParsing = true;
              return;
            }
            lastRunNumber = event.runNumber;
          }
          events.push(event);
        }
        // Silently skip rows that don't parse (headers, empty rows, etc.)
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: i,
            section: "generic",
            error: String(err),
            rawText: $(el).text().trim().slice(0, 2000),
          },
        ];
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        containerFound: container.length > 0,
        rowsFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
