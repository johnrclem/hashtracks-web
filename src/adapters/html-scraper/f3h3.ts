/**
 * F3H3* (Finally Friday Fukov Hash House Harriers) Hareline Scraper
 *
 * Scrapes f3h3.net — a classic static HTML page with a hareline table
 * (id="hareline") containing columns: Date | Run# | Station | Venue | Hare(s) | Notes.
 *
 * Dates are year-less ordinal strings (e.g., "April 3rd", "April 10th") —
 * chrono-node infers the year with forwardDate.
 *
 * Rows with empty run numbers and all-blank content cells are "off weeks" — skipped.
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
  chronoParseDate,
  stripPlaceholder,
} from "../utils";

/** Days to backdate chrono reference so forwardDate doesn't push recent dates
 *  into next year when scraping shortly after the event. */
const RECENT_EVENT_TOLERANCE_DAYS = 7;

/**
 * Parse a single hareline row into RawEventData.
 * Exported for unit testing.
 */
export function parseHarelineRow(
  cells: string[],
  sourceUrl: string,
  referenceDate?: Date,
): RawEventData | null {
  if (cells.length < 6) return null;

  const [rawDate, rawRun, rawStation, rawVenue, rawHares, rawNotes] = cells;

  // --- Date ---
  const dateText = rawDate?.trim();
  if (!dateText) return null;

  let ref = referenceDate;
  if (ref) {
    ref = new Date(ref);
    ref.setHours(0, 0, 0, 0);
    ref.setDate(ref.getDate() - RECENT_EVENT_TOLERANCE_DAYS);
  }
  const date = chronoParseDate(dateText, "en-US", ref, { forwardDate: true });
  if (!date) return null;

  // --- Run Number ---
  const runNum = parseInt(rawRun?.trim() ?? "", 10);
  const runNumber = !isNaN(runNum) ? runNum : undefined;

  // --- Station (used as location) ---
  const station = stripPlaceholder(rawStation);

  // --- Venue ---
  const venue = stripPlaceholder(rawVenue);

  // --- Hares ---
  const hares = stripPlaceholder(rawHares);

  // --- Notes (used as description) ---
  const notesText = rawNotes?.trim().replace(/\s+/g, " ") || undefined;
  const notes = notesText && notesText !== "\u00a0" ? notesText : undefined;

  // Skip off-week rows (no run number AND no station/hares/notes)
  if (!runNumber && !station && !hares && !notes) return null;

  // Build title
  const title = runNumber
    ? `F3H3 #${runNumber}`
    : "F3H3 Friday Trail";

  // Location: prefer venue, fallback to station
  const location = venue || station;

  // Description: combine station + notes when both present
  const descParts: string[] = [];
  if (station && venue) descParts.push(`Station: ${station}`);
  if (notes) descParts.push(notes);
  const description = descParts.length > 0 ? descParts.join("\n") : undefined;

  return {
    date,
    kennelTag: "f3h3",
    title,
    runNumber,
    hares,
    location,
    startTime: "19:30", // Default per site: "pack starts running at 19:30"
    sourceUrl,
    description,
  };
}

export class F3H3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://www.f3h3.net/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const scrapeDate = new Date();

    // The hareline table has id="hareline"
    const rows = $("table#hareline tr");

    rows.each((i, el) => {
      const $row = $(el);
      const tds = $row.find("> td");

      // Skip header row (first row uses <td> not <th>) and malformed rows
      if (i === 0 || tds.length < 6) return;

      try {
        const cells = tds.map((_, td) => $(td).text().trim()).get();

        const event = parseHarelineRow(cells, url, scrapeDate);
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
