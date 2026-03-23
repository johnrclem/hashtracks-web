/**
 * Rhode Island Hash House Harriers (RIH3) Hareline Scraper
 *
 * Scrapes rih3.com/hareline.html — a classic static HTML page (CoffeeCup editor,
 * late 1990s) with a 5-column table: Date | Time | Run# | Hare | Directions.
 *
 * Two tables on the page: first is the hareline (upcoming runs), second is the
 * "Hareline Doghouse" (absent members) — skip the second.
 *
 * Dates are year-less (e.g., "Mon March 23") — chrono-node infers the year.
 * Hare names appear in <span> elements and as "and"/"&" text nodes between images.
 * Directions cell contains H2 title, narrative description, and Google Maps links.
 */

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
  fetchHTMLPage,
  chronoParseDate,
  parse12HourTime,
  isPlaceholder,
} from "../utils";

const DAY_PREFIX_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?\s+/i;

/**
 * Extract hare name(s) from the hare cell HTML.
 *
 * Hare names appear as text inside <span>/<strong> elements, sometimes with
 * "and" or "&" separators. Extra content (song links, prose) appears in <p>
 * and <a> elements below hare images — removed before text extraction.
 */
export function extractHares(hareHtml: string): string | undefined {
  const $ = cheerio.load(hareHtml);

  // Remove non-hare content
  $("p").remove();
  $("img").remove();
  $("a").remove();
  $("font").remove();

  const text = $("body").text();
  const names = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^(?:and|&)\s+/i, "").trim())
    .filter((n) => n.length > 1 && !isPlaceholder(n));

  return names.length > 0 ? names.join(", ") : undefined;
}

/**
 * Parse a single hareline table row into RawEventData.
 * Exported for unit testing.
 *
 * @param cells - text content of first 3 cells [date, time, runNumber]
 * @param hareHtml - innerHTML of the hare cell (td[3])
 * @param directionHtml - innerHTML of the directions cell (td[4])
 * @param sourceUrl - the source URL for attribution
 * @param referenceDate - reference date for year inference on year-less dates
 */
export function parseHarelineRow(
  cells: string[],
  hareHtml: string,
  directionHtml: string,
  sourceUrl: string,
  referenceDate?: Date,
): RawEventData | null {
  if (cells.length < 3) return null;

  // --- Date (year-less, e.g., "Mon March 23") ---
  const rawDate = cells[0]?.trim();
  if (!rawDate) return null;
  // Normalize reference to start-of-day to prevent forwardDate from advancing
  // same-day events to next year (chrono parses year-less dates as midnight,
  // which is "before" a mid-day reference → year drift)
  let ref = referenceDate;
  if (ref) {
    ref = new Date(ref);
    ref.setHours(0, 0, 0, 0);
  }
  const date = chronoParseDate(rawDate, "en-US", ref, {
    forwardDate: true,
  });
  if (!date) return null;

  // --- Time (12h, e.g., "6:30 PM" or "Mon 6:30 PM") ---
  const rawTime = (cells[1]?.trim() ?? "").replace(DAY_PREFIX_RE, "");
  const startTime = parse12HourTime(rawTime) || "18:30";

  // --- Run Number ---
  const runNum = parseInt(cells[2]?.trim() ?? "", 10);
  const runNumber = !isNaN(runNum) ? runNum : undefined;

  // --- Hares ---
  const hares = extractHares(hareHtml);

  // --- Directions cell: title, location, description ---
  const dir$ = cheerio.load(directionHtml);

  // Title from <h2>
  dir$("h2").find("br").replaceWith(" ");
  const h2Text = dir$("h2")
    .first()
    .text()
    .trim()
    .replace(/\s+/g, " ");
  const title =
    h2Text ||
    (runNumber ? `RIH3 #${runNumber}` : "RIH3 Monday Trail");

  // Location from Google Maps link
  const mapsLink = dir$(
    'a[href*="google.com/maps"], a[href*="maps.google"]',
  ).first();
  const locationUrl = mapsLink.length
    ? mapsLink.attr("href")?.trim()
    : undefined;
  const locationText = mapsLink.length
    ? mapsLink.text().trim()
    : undefined;
  const location =
    locationText && locationText.length > 3 ? locationText : undefined;

  // Description: body text minus title and song links; preserve Facebook link
  const descRoot = dir$("body").clone();
  descRoot.find("h2").remove();
  descRoot
    .find('a[href*="Songs/"], a[href$=".txt"], a[href$=".rtf"]')
    .closest("p")
    .remove();
  // Convert Facebook link to plain text with URL instead of removing it
  descRoot.find('a[href*="facebook.com/groups"]').each((_, a) => {
    const $a = dir$(a);
    const href = $a.attr("href") ?? "";
    const text = $a.text().trim();
    $a.replaceWith(`${text} (${href})`);
  });
  const description =
    descRoot.text().replace(/\s+/g, " ").trim().replace(/^[,\s]+/, "") ||
    undefined;

  return {
    date,
    kennelTag: "rih3",
    title,
    runNumber,
    hares,
    location,
    locationUrl,
    startTime,
    sourceUrl,
    description,
  };
}

export class RIH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl = source.url || "https://rih3.com/hareline.html";

    const page = await fetchHTMLPage(harelineUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const scrapeDate = new Date();

    // First table = hareline events (skip second "Doghouse" table)
    const rows = $("table").first().find("tr");

    rows.each((i, el) => {
      const $row = $(el);
      const tds = $row.find("> td");

      // Skip header row (first row) and malformed rows
      if (i === 0 || tds.length < 5) return;

      try {
        // Extract text for simple columns
        const cells = tds
          .slice(0, 3)
          .map((_, td) => $(td).text().trim())
          .get();

        // Pass raw HTML for complex columns (hare + directions)
        const hareHtml = $(tds[3]).html() ?? "";
        const directionHtml = $(tds[4]).html() ?? "";

        const event = parseHarelineRow(
          cells,
          hareHtml,
          directionHtml,
          harelineUrl,
          scrapeDate,
        );
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
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
