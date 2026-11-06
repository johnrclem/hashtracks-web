/**
 * Milton Keynes H3 (MKH3) HTML Scraper
 *
 * Scrapes mkh3.co.uk/runs-events — a concrete5 site with two server-rendered
 * calendar event-list widgets, "Forthcoming Runs" (regular Monday runs) and
 * "Forthcoming Events" (specials). Each `.ccm-block-calendar-event-list-event`:
 *   -event-title      venue "Cannon, Newport Pagnell - MK16 8AQ", or a
 *                     placeholder ("Hares Required", "No Run"); for the
 *                     Events widget it is the event's name ("Arseover's 1000th - TBA")
 *   -event-date-full  "Nov 9, 2026, 6:50 PM – 9:00 PM" (year-bearing)
 *   -event-description <p> lines: "Run: 1940", "Hares: A, B", free text
 * "No Run" blocks are skipped. Run numbers are best-effort (the site has
 * repeated a number on two dates before) — merge identity is kennel + date.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, buildDateWindow, MONTHS } from "../utils";

const KENNEL_TAG = "mkh3";
const DEFAULT_URL = "https://mkh3.co.uk/runs-events";

const FULL_DATE_RE = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)/gi;
const RUN_RE = /^Run:?\s*(\d{1,5})\b/i;
const HARES_RE = /^Hares?:?\s+(\S.*)$/i;
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
/** Recruiting boilerplate the site appends to every unclaimed run. */
const CTA_PREFIXES = ["if you would like to set", "or use the, get in touch", "or use the get in touch"];

function clean(text: string): string {
  return text.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

function to24h(hour: number, minute: string, ampm: string): string | undefined {
  if (hour < 1 || hour > 12) return undefined;
  let h = hour % 12;
  if (ampm.toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

/** "Nov 9, 2026, 6:50 PM – 9:00 PM" → date + start/end times. */
export function parseMkDateLine(text: string): { date: string; startTime?: string; endTime?: string } | null {
  const m = FULL_DATE_RE.exec(text);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const year = Number.parseInt(m[3], 10);
  const day = Number.parseInt(m[2], 10);
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const times = [...text.matchAll(TIME_RE)].map((t) => to24h(Number.parseInt(t[1], 10), t[2], t[3]));
  return { date: dt.toISOString().slice(0, 10), startTime: times[0], endTime: times[1] };
}

function isPlaceholderTitle(title: string): boolean {
  const t = title.toLowerCase();
  return t === "" || t === "tba" || t === "tbc" || t.startsWith("hares required") || t.startsWith("hare required");
}

/** Split "Cannon, Newport Pagnell - MK16 8AQ" into venue + postcode. */
export function splitMkVenue(title: string): { location?: string; locationStreet?: string } {
  if (isPlaceholderTitle(title)) return {};
  const idx = title.lastIndexOf(" - ");
  if (idx !== -1 && UK_POSTCODE_RE.test(title.slice(idx + 3).trim())) {
    return { location: title.slice(0, idx).trim(), locationStreet: title.slice(idx + 3).trim().toUpperCase() };
  }
  return { location: title };
}

/** Parse both event-list widgets on the runs-events page. Exported for tests. */
export function parseMkRunsEvents(html: string, sourceUrl = DEFAULT_URL): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $(".ccm-block-calendar-event-list-wrapper").each((_w, wrapper) => {
    const isSpecials = /events/i.test(clean($(wrapper).find("h2").first().text()));
    $(wrapper).find(".ccm-block-calendar-event-list-event").each((_i, el) => {
      const $el = $(el);
      const title = clean($el.find(".ccm-block-calendar-event-list-event-title").first().text());
      if (/^no run\b/i.test(title)) return;
      const when = parseMkDateLine(clean($el.find(".ccm-block-calendar-event-list-event-date-full").first().text()));
      if (!when) return;

      let runNumber: number | undefined;
      let hares: string | undefined;
      const notes: string[] = [];
      $el.find(".ccm-block-calendar-event-list-event-description p").each((_j, p) => {
        // <br> splits "Run: 1941<br>Venue TBA" into separate lines.
        const lines = ($(p).html() ?? "").split(/<br\s*\/?>/i).map((h) => clean(cheerio.load(h).text()));
        for (const line of lines) {
          if (!line || CTA_PREFIXES.some((p) => line.toLowerCase().startsWith(p))) continue;
          const run = RUN_RE.exec(line);
          const hare = HARES_RE.exec(line);
          if (run) runNumber ??= Number.parseInt(run[1], 10);
          else if (hare) hares = hare[1];
          else notes.push(line);
        }
      });

      // Specials' title is the event name, not a venue.
      const eventName = isSpecials ? title.replace(/\s+-\s+TB[AC]$/i, "").trim() : undefined;
      const venue = isSpecials ? {} : splitMkVenue(title);

      events.push({
        date: when.date,
        kennelTags: [KENNEL_TAG],
        runNumber,
        title: eventName || undefined,
        startTime: when.startTime,
        endTime: when.endTime,
        location: venue.location,
        locationStreet: venue.locationStreet,
        hares,
        description: notes.length > 0 ? notes.join("\n") : undefined,
        sourceUrl,
      });
    });
  });

  return events;
}

export class MkH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { html, $, structureHash, fetchDurationMs } = page;

    const blocks = $(".ccm-block-calendar-event-list-event").length;
    const parsed = parseMkRunsEvents(html, sourceUrl);
    // A page of only "No Run" blocks is legitimate; zero blocks is drift.
    if (blocks === 0) {
      return {
        events: [],
        errors: ["MKH3: no calendar event blocks found on runs-events — layout drift"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 90);
    const events = parsed.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    return {
      events,
      errors: [],
      structureHash,
      diagnosticContext: { blocksFound: blocks, runsParsed: parsed.length, eventsInWindow: events.length, fetchDurationMs },
    };
  }
}
