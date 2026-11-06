/**
 * Cebu Hash House Harriers (Cebu H3) — Cebu City, Philippines (est. July 1997).
 *
 * cebuhash.wordpress.com renders a Jetpack "Upcoming Events" widget
 * (`ul.upcoming-events`) in the sidebar of every page. Each `<li>` carries:
 *
 *   strong.event-summary     "Hash #1564 - Turning Wheels" / "Hash #1566" / "Hash Meeting"
 *   span.event-when          "8th Nov 2026 at 3:00 pm – 5:00 pm" / "15th Nov 2026"
 *   span.event-location      "Turning Wheels Craft Brewery, P. Almendras St, Cebu City, …"   (optional)
 *   span.event-description   "Hash Trail #1564 is from … Hare is Tiger Ass."                 (optional)
 *
 * Only "Hash #N" items are runs; committee meetings ("Hash Meeting",
 * "Mismanagement Meeting") are skipped. The text after the run number names
 * either the venue or the hares, so it is not used as a title (merge
 * synthesizes "Cebu H3 Trail #N"); hares come from the description's
 * "Hare is …" / "Hares are …" sentence. The widget is a rolling window, so the
 * source ships `upcomingOnly: true`.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import { fetchHTMLPage, filterEventsByWindow } from "../utils";

const KENNEL_TAG = "cebu-h3";
const DEFAULT_URL = "https://cebuhash.wordpress.com/";

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
const RUN_SUMMARY_RE = /^Hash #(\d{3,5})\b/i;
const WHEN_DATE_RE = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}) (\d{4})/;
const CLOCK_RE = /(\d{1,2}):(\d{2}) ?(am|pm)/gi;
// "Hare is Tiger Ass." / "Hares are A and B." — up to the sentence end.
const HARES_RE = /\bhares? (?:is|are) ([^.]{2,120})/i;

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

function to24h(h: string, m: string, ampm: string): string {
  let hour = Number.parseInt(h, 10);
  if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${m}`;
}

/** "8th Nov 2026 at 3:00 pm – 5:00 pm" → date + start/end; null date if malformed. */
export function parseCebuWhen(text: string): { date: string | null; startTime?: string; endTime?: string } {
  const m = WHEN_DATE_RE.exec(clean(text));
  const month = m ? MONTHS.get(m[2].slice(0, 3).toLowerCase()) : undefined;
  if (!m || !month) return { date: null };
  const day = Number.parseInt(m[1], 10);
  const d = new Date(Date.UTC(Number.parseInt(m[3], 10), month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return { date: null };
  const clocks = [...text.matchAll(CLOCK_RE)].map((c) => to24h(c[1], c[2], c[3]));
  return { date: d.toISOString().slice(0, 10), startTime: clocks[0], endTime: clocks[1] };
}

/** "… Hare is Tiger Ass." → "Tiger Ass"; "Hares are A & B" → "A, B". */
export function haresFromDescription(text: string): string | undefined {
  const m = HARES_RE.exec(text);
  if (!m) return undefined;
  const names = m[1]
    .replaceAll(" and ", ",")
    .replaceAll("&", ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ") : undefined;
}

/** Parse the widget. Exported for tests. */
export function parseCebuWidget(html: string): { events: RawEventData[]; widgetFound: boolean; parseErrors: ParseError[] } {
  const $ = cheerio.load(html);
  // The same list can also be embedded in page content; take the first one.
  const list = $("ul.upcoming-events").first();
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];
  list.find("li").each((i, li) => {
    const summary = clean($(li).find(".event-summary").text());
    const run = RUN_SUMMARY_RE.exec(summary);
    if (!run) return; // meetings and other notices
    const when = parseCebuWhen($(li).find(".event-when").text());
    if (!when.date) {
      parseErrors.push({ row: i, section: "upcoming-events", error: `Cebu H3: unparseable date for "${summary}"` });
      return;
    }
    const description = clean($(li).find(".event-description").text()) || undefined;
    events.push({
      date: when.date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(run[1], 10),
      startTime: when.startTime,
      endTime: when.endTime,
      location: clean($(li).find(".event-location").text()) || undefined,
      hares: description ? haresFromDescription(description) : undefined,
      description,
      sourceUrl: DEFAULT_URL,
    });
  });
  return { events, widgetFound: list.length > 0, parseErrors };
}

export class CebuHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { events, widgetFound, parseErrors } = parseCebuWidget(page.html);
    const errors = parseErrors.map((p) => p.error);
    // The widget can legitimately list only a committee meeting between postings,
    // so zero runs is not an error — only a missing widget is.
    if (!widgetFound) errors.push(`Cebu H3: "upcoming-events" widget not found at ${url}`);
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    return {
      events: windowed,
      errors,
      structureHash: page.structureHash,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      diagnosticContext: { totalBeforeFilter: events.length, eventsParsed: windowed.length, fetchDurationMs: page.fetchDurationMs },
    };
  }
}
