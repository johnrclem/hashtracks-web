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

function toUtcNoon(day: number, month: number, year: number): string | null {
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  const hares = isPlaceholderCell(cells[3]) ? undefined : cells[3]?.trim();
  const venueLink = hrefs[4];
  const location = isPlaceholderCell(cells[4]) ? undefined : cells[4]?.trim();
  const street = isPlaceholderCell(cells[5]) ? undefined : cells[5]?.trim();
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
    // what3words is not a Maps URL — never set locationUrl from it.
    locationUrl: venueLink && /maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(venueLink) ? venueLink : undefined,
  };
}

export class HertsHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://www.hertshash.co.uk/hare_line.htm";
    const page = await fetchHTMLPage(sourceUrl);
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
        $td.find("br").replaceWith(" ");
        cells.push($td.text().replace(/\s+/g, " ").trim());
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
        (errorDetails.parse ??= []).push({
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
