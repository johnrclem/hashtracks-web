/**
 * Herts H3 (Hertfordshire, England) HTML Scraper
 *
 * Scrapes hertshash.co.uk/hare_line.htm — a static legacy FrontPage-generated
 * page with a single 7-column `<table>` of forward runs. The table is
 * mixed-kennel: it interleaves Herts H3 runs with F.U.K Full Moon H3 runs and
 * occasional one-off social events (Charity Quiz, ADULT PANTO, ...). Only
 * rows whose first cell reads "Herts H3 <number>" are Herts H3 runs — every
 * other row is filtered out by design (not routed elsewhere).
 *
 * Columns: [0] kennel+run designator | [1] weekday+date | [2] time |
 * [3] hares | [4] venue (linked) | [5] address | [6] postcode+what3words
 *
 * The venue and address cells stack several <p> lines: the real value first, then
 * notes, a second venue or a "Volunteer Scribe Please!" banner (#2812). Cells keep
 * those line breaks as "\n"; the first real line is the value, and any leftover
 * notes go to the description.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, buildDateWindow } from "../utils";
import { parseHrsTime, isPlaceholderCell } from "./legacy-frontpage-utils";

const RUN_RE = /Herts\s*H\s*3\s*(\d{3,5})/i;
const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;
const UK_POSTCODE_RE = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;
const CELL_LINE_BREAK = "\uE000"; // Private-use marker, survives whitespace collapsing.

function toUtcNoon(day: number, month: number, year: number): string | null {
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Lines too short or too generic to be a venue, address or useful note ("V", the rugby-style "N1 V S1"). */
function isNoiseLine(line: string): boolean {
  return (
    line.length <= 2 ||
    /volunteer scribe/i.test(line) ||
    /^[NS]\d+ V [NS]\d+/i.test(line) ||
    /^\d{1,2}:\d{2} ?Hrs$/i.test(line)
  );
}

/**
 * Index of the street line, or -1. A street starts with a house number or has
 * comma-separated parts; notes usually do neither.
 */
function streetIndex(lines: string[], hasVenue: boolean): number {
  const numbered = lines.findIndex((line) => /^\d/.test(line));
  if (numbered !== -1 || !hasVenue) return numbered; // With no venue, a comma line is a theme note ("CAVEMAN TRAIL, DRESS AS…").
  return Math.max(lines.findIndex((line) => line.includes(",")), 0);
}

/** A cell's meaningful lines, dropping placeholders ("TBC") and noise. */
function cellLines(cell: string | undefined): string[] {
  return (cell ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !isPlaceholderCell(line) && !isNoiseLine(line));
}

/** Parse a single hareline `<tr>`'s cell texts into a RawEventData, or null to skip the row. */
export function parseHertsRow(cells: string[], hrefs: (string | undefined)[]): RawEventData | null {
  if (cells.length < 7) return null;

  const runMatch = RUN_RE.exec(cells[0] ?? "");
  if (!runMatch) return null; // F.U.K Full Moon H3 / one-off social rows — not ours
  const runNumber = Number.parseInt(runMatch[1], 10);

  const dateMatch = DATE_RE.exec(cells[1] ?? "");
  if (!dateMatch) return null;
  const date = toUtcNoon(
    Number.parseInt(dateMatch[1], 10),
    Number.parseInt(dateMatch[2], 10),
    Number.parseInt(dateMatch[3], 10),
  );
  if (!date) return null;

  const startTime = parseHrsTime(cells[2]);
  const hares = isPlaceholderCell(cells[3]) ? undefined : cells[3]?.replace(/\s+/g, " ").trim();
  const venueLink = hrefs[4];
  const [location, ...venueNotes] = cellLines(cells[4]);
  const addressLines = cellLines(cells[5]);
  const streetAt = streetIndex(addressLines, location !== undefined);
  // An address can break across two <p> lines: "47 Heath Road, Little Heath," / "Potter's Bar".
  const streetLines = streetAt === -1 ? [] : addressLines.slice(streetAt, streetAt + (addressLines[streetAt]?.endsWith(",") ? 2 : 1));
  const street = streetLines.join(" ") || undefined;
  const notes = [...venueNotes, ...addressLines.filter((_, i) => i < streetAt || i >= streetAt + streetLines.length)];
  const postcodeMatch = UK_POSTCODE_RE.exec(cells[6] ?? "");
  const locationStreet = postcodeMatch
    ? [street, postcodeMatch[0]].filter(Boolean).join(", ")
    : street;

  return {
    date,
    kennelTags: ["herts-h3"],
    runNumber,
    startTime,
    hares,
    location,
    locationStreet,
    // null (not undefined) so a note removed from the page clears on the event.
    description: notes.length > 0 ? notes.join(" ") : null,
    // what3words is not a Maps URL — never set locationUrl from it.
    locationUrl: venueLink && /maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(venueLink) ? venueLink : undefined,
  };
}

export class HertsHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://www.hertshash.co.uk/hare_line.htm";
    // The site declares a non-UTF-8 charset (meta tag only); decode per that
    // declaration so "£6" doesn't become "\uFFFD6".
    const page = await fetchHTMLPage(sourceUrl, { charsetAware: true });
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const rows = $("table tr");
    let herts = 0;

    rows.each((i, el) => {
      const $row = $(el);
      const cells: string[] = [];
      const hrefs: (string | undefined)[] = [];
      $row.find("td").each((_j, td) => {
        const $td = $(td);
        // The HTML source wraps long lines, so only <br>/<p> count as line breaks.
        $td.find("br").replaceWith(CELL_LINE_BREAK);
        $td.find("p").prepend(CELL_LINE_BREAK);
        cells.push(
          $td.text().replace(/\s+/g, " ").replaceAll(CELL_LINE_BREAK, "\n").replace(/ ?\n ?/g, "\n").trim(),
        );
        hrefs.push($td.find("a").first().attr("href") || undefined);
      });
      if (cells.length === 0) return;

      try {
        const event = parseHertsRow(cells, hrefs);
        if (!event) return;
        herts++;
        const eventDate = new Date(event.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) return;
        events.push(event);
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse ??= [];
        errorDetails.parse.push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: $row.text().trim().slice(0, 2000),
        });
      }
    });

    if (herts === 0) {
      errors.push("Herts hareline: 0 Herts H3 rows parsed — markup drift");
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        hertsRowsParsed: herts,
        eventsInWindow: events.length,
        fetchDurationMs,
      },
    };
  }
}
