/**
 * Sumo Hash House Harriers (Sumo H3) Hareline Scraper
 *
 * Scrapes sumoh3.gotothehash.net — a WordPress site using the "Events Made Easy"
 * plugin. The hareline is a table with columns:
 * Run# | Date | Event Description | Station | Line | Hare
 *
 * Run# cells contain a link to the detail page + "(click here)" — we extract
 * the run number from the link title attribute, NOT fetching detail pages.
 *
 * Date format: "DD Mon" (e.g., "05 Apr", "11 Apr 12 Apr" for multi-day).
 * Current year is implied.
 *
 * Multi-day events (e.g., "11 Apr 12 Apr") use the first date.
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
  fetchHTMLPage,
  MONTHS,
  stripPlaceholder,
  isPlaceholder,
} from "../utils";

/** Parse "DD Mon" into "YYYY-MM-DD" using current (or reference) year. */
export function parseSumoDate(
  text: string,
  referenceDate?: Date,
): string | null {
  const trimmed = text.trim();
  // Handle multi-day: "11 Apr 12 Apr" — take the first date only
  const match = /^(\d{1,2})\s+([A-Za-z]{3})/.exec(trimmed);
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const month = MONTHS[monthStr];
  if (!month || day < 1 || day > 31) return null;

  const ref = referenceDate ?? new Date();
  const year = ref.getFullYear();

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single hareline row into RawEventData.
 * Exported for unit testing.
 */
export function parseHarelineRow(
  cells: string[],
  runNumberFromLink: number | undefined,
  sourceUrl: string,
  referenceDate?: Date,
): RawEventData | null {
  if (cells.length < 6) return null;

  const [_rawRun, rawDate, rawDescription, rawStation, _rawLine, rawHare] = cells;

  // --- Date ---
  const date = parseSumoDate(rawDate ?? "", referenceDate);
  if (!date) return null;

  // --- Run Number (from link title attribute, more reliable than cell text) ---
  const runNumber = runNumberFromLink;

  // --- Description / Title ---
  const descText = rawDescription?.trim().replaceAll(/\s+/g, " ") || undefined;
  const isPlaceholderDesc =
    !descText || isPlaceholder(descText) || /^HARE NEEDED/i.test(descText);

  const title = runNumber
    ? `Sumo H3 #${runNumber}`
    : "Sumo H3 Sunday Trail";

  // --- Station (used as location) ---
  const station = stripPlaceholder(rawStation);

  // --- Hare ---
  const hares = stripPlaceholder(rawHare);

  // Skip rows that are just placeholders with no useful info
  if (isPlaceholderDesc && !station && !hares) return null;

  // Build description from event description field (if not placeholder)
  const description = isPlaceholderDesc ? undefined : descText;

  return {
    date,
    kennelTags: ["sumo-h3"],
    title,
    runNumber,
    hares,
    location: station,
    startTime: "14:00", // Default per site: "Sumo Hashers meet every Sunday at 2:00 pm"
    sourceUrl,
    description,
  };
}

export class SumoH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://sumoh3.gotothehash.net/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const scrapeDate = new Date();

    // The hareline table has <th> header row: Run | Date | Event Description | Station | Line | Hare
    // Find the table that contains a <th> with "Run" text
    const table = $("table")
      .filter((_, el) => $(el).find("th").first().text().trim() === "Run")
      .first();

    const rows = table.find("tr");

    rows.each((i, el) => {
      const $row = $(el);

      // Skip header row (contains <th> elements)
      if ($row.find("th").length > 0) return;

      const tds = $row.find("> td");
      if (tds.length < 6) return;

      try {
        // Extract run number from the link title attribute in first cell
        const runLink = $(tds[0]).find("a").first();
        const runTitle = runLink.attr("title")?.trim();
        const runNum = runTitle ? Number.parseInt(runTitle, 10) : NaN;
        const runNumber = !Number.isNaN(runNum) ? runNum : undefined;

        const cells = tds.map((_, td) => $(td).text().trim()).get();

        const event = parseHarelineRow(cells, runNumber, url, scrapeDate);
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        if (!errorDetails.parse) errorDetails.parse = [];
        errorDetails.parse.push({
          row: i,
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
