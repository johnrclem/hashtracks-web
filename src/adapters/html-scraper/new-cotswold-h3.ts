import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, fetchHTMLPage, MONTHS } from "../utils";

const KENNEL_TAG = "newch3";
const DEFAULT_URL = "https://www.newch3.org.uk/";
const START_TIME = "11:00";

/** Date header cell `8<sup>th</sup> November, 2026` → text `8th November, 2026`. */
const DATE_RE = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+),? (\d{4})$/;

function clean(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function isTbd(value: string): boolean {
  const v = value.toUpperCase();
  return v === "" || v === "TBD" || v === "TBC" || v === "TBA";
}

export function parseRowDate(text: string): string | null {
  // The page brackets Christmas runs with 🎄 inside the date cell.
  const m = DATE_RE.exec(clean(text.replaceAll("🎄", "")));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  const d = new Date(Date.UTC(Number.parseInt(m[3], 10), month - 1, day, 12, 0, 0));
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month - 1) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Rows of the run table shared by the homepage (upcoming) and `/past/`:
 * `<th>Date</th><td>Run No.</td><td>Venue</td><td>Address</td><td>Hare(s)</td>`.
 * The date sits in a `<th scope="row">`, so cells are read from both tags.
 */
export function parseRunTable($: CheerioAPI, sourceUrl: string): RawEventData[] {
  const events: RawEventData[] = [];
  $("tr").each((_i, tr) => {
    const $tr = $(tr);
    const header = $tr.children("th").first();
    const cells = $tr.children("td").map((_j, td) => clean($(td).text().replaceAll("🎄", ""))).get();
    // TBD rows merge venue + address into one `colspan="2"` cell: [run, venue, hares].
    if (header.length === 0 || cells.length < 3) return;
    const date = parseRowDate(header.text());
    const runNumber = Number.parseInt(cells[0], 10);
    if (!date || !Number.isFinite(runNumber)) return;
    const venue = cells[1];
    const address = cells.length >= 4 ? cells[2] : "";
    const hares = cells.at(-1) ?? "";
    const mapHref = $tr.find('a[title="Google Map"]').attr("href");
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      // 11:00 is the Sunday start; the odd weekday special keeps its time unset.
      startTime: new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? START_TIME : undefined,
      location: isTbd(venue) ? undefined : venue,
      locationStreet: isTbd(address) ? undefined : address,
      locationUrl: mapHref,
      hares: isTbd(hares) ? undefined : hares,
      sourceUrl,
    });
  });
  return events;
}

/**
 * N.E.W. Cotswold H3 — biweekly Sunday 11:00 across the North/East/West
 * Cotswolds. The homepage holds an "Upcoming Trails" table (date, run #,
 * venue, address + postcode map link, hares); runs move to `/past/` once
 * done, so the source needs `upcomingOnly`. The `/past/` page (same layout)
 * feeds the one-shot history backfill.
 */
export class NewCotswoldH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events = parseRunTable($, url);
    const errors: string[] = [];
    if (events.length === 0) {
      errors.push("N.E.W. Cotswold H3: 0 runs parsed from the Upcoming Trails table — markup may have changed");
    }
    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, eventsParsed: events.length },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? 90);
  }
}
