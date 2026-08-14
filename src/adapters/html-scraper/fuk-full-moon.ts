/**
 * F.U.K Full Moon H3 (FUKFM, London / Greater North London) HTML Scraper
 *
 * Scrapes fukfmh3.co.uk/hareline.htm — a static legacy FrontPage-generated
 * page, same platform as Herts H3 but a different 5-column layout with no
 * archive page (forward-only). Columns: [0] run number | [1] date (weekday +
 * day, month[+explicit 'YY year], time — 3 stacked lines) | [2] venue
 * (linked) | [3] hares | [4] address + postcode + transport notes.
 *
 * Near-term rows carry no year; later rows mark an explicit `'YY` after the
 * month name. Rows are in forward chronological order on the page, so a
 * walking reference date + chrono's forwardDate resolves the year-less rows
 * without enumerating month names in a regex (Sonar S5843).
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, buildDateWindow, chronoParseDate } from "../utils";
import { parseHrsTime, isPlaceholderCell } from "./legacy-frontpage-utils";

const RUN_RE = /^(\d{2,5})$/;
const EXPLICIT_YEAR_RE = /'(\d{2})\b/;

/**
 * Reference-date-walking date parser for the year-less "24th October" /
 * "23rd January '27" cell. Mutates nothing — caller advances its own cursor
 * from the returned date.
 */
export function parseFukfmDate(dateText: string, referenceDate: Date): string | null {
  const yearMatch = EXPLICIT_YEAR_RE.exec(dateText);
  const cleaned = dateText.replace(EXPLICIT_YEAR_RE, "").replace(/\s+/g, " ").trim();
  const withYear = yearMatch ? `${cleaned} 20${yearMatch[1]}` : cleaned;
  return chronoParseDate(withYear, "en-GB", referenceDate, { forwardDate: true });
}

/** Parse a single hareline `<tr>`'s cell texts into a RawEventData. `referenceDate` walks forward across rows for year inference. */
export function parseFukfmRow(
  cells: string[],
  hrefs: (string | undefined)[],
  referenceDate: Date,
): RawEventData | null {
  if (cells.length < 5) return null;

  const runMatch = RUN_RE.exec((cells[0] ?? "").trim());
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  const date = parseFukfmDate(cells[1] ?? "", referenceDate);
  if (!date) return null;

  const startTime = parseHrsTime(cells[1]);
  const venueLink = hrefs[2];
  const location = isPlaceholderCell(cells[2]) ? undefined : cells[2]?.trim();
  const hares = isPlaceholderCell(cells[3]) ? undefined : cells[3]?.trim();
  const locationStreet = isPlaceholderCell(cells[4]) ? undefined : cells[4]?.trim();

  return {
    date,
    kennelTags: ["fukfm"],
    runNumber,
    startTime,
    location,
    hares,
    locationStreet,
    // what3words is not a Maps URL — never set locationUrl from it.
    locationUrl: venueLink && /maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(venueLink) ? venueLink : undefined,
  };
}

export class FukFullMoonH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://fukfmh3.co.uk/hareline.htm";
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const rows = $("table tr");
    let referenceDate = new Date();
    let parsed = 0;

    rows.each((i, el) => {
      const $row = $(el);
      const cells: string[] = [];
      const hrefs: (string | undefined)[] = [];
      $row.find("td").each((_j, td) => {
        const $td = $(td);
        $td.find("br").replaceWith(" ");
        cells.push($td.text().replace(/\s+/g, " ").trim());
        hrefs.push($td.find("a").first().attr("href") || undefined);
      });
      if (cells.length === 0) return;

      try {
        const event = parseFukfmRow(cells, hrefs, referenceDate);
        if (!event) return;
        parsed++;
        // Advance the walking reference so the next year-less row resolves
        // forward from here (handles the Dec -> Jan rollover).
        referenceDate = new Date(event.date + "T12:00:00Z");
        const eventDate = new Date(event.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) return;
        events.push(event);
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

    if (parsed === 0) {
      errors.push("FUKFM hareline: 0 run rows parsed — markup drift");
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: parsed,
        eventsInWindow: events.length,
        fetchDurationMs,
      },
    };
  }
}
