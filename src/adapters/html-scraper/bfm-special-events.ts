import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { filterEventsByWindow, MONTHS } from "../utils";
import { safeFetch } from "../safe-fetch";
import { toIsoDateString } from "@/lib/date";

/**
 * Ben Franklin Mob H3 (Philadelphia) marquee/special-events adapter (#765).
 *
 * benfranklinmob.com/bfm-special-events/ is a WordPress.com page listing the
 * kennel's annual special events (Train Hash, Mayor's Cup, Fearadelphia campout,
 * Marathon Beer Check, AGM, …) — SEPARATE from the weekly Thursday runs the
 * URL-routed BFMAdapter reads. Each event is a bold "medium font" heading
 * paragraph followed by a "YYYY Date: <Weekday>, <Month> <Day>[ – <Weekday>,
 * <Month> <Day>]" paragraph (or "No Current Date").
 *
 * Registered under a MORE-SPECIFIC url pattern than the generic benfranklinmob
 * entry so the two coexist. The source is `upcomingOnly` — the page carries both
 * just-passed and future events, so reconcile must be future-clamped or a passed
 * special (still shown on the page until the kennel updates it) would be
 * cancelled the moment its date flips to "No Current Date".
 */

const KENNEL_TAG = "bfm";

/** Leading "YYYY Date:" prefix — the authoritative year (a trailing ", YYYY" in
 *  the prose is sometimes a typo, e.g. the AGM's "2027 Date: … 2026"). */
const YEAR_PREFIX_RE = /^\s*(\d{4})\s+Date\s*:/i;
/** `<word> <day>[st|nd|rd|th]` pairs; the word is filtered through MONTHS so the
 *  weekday ("Thursday") is ignored and only real month names count. Simple shape
 *  (no month alternation, single `\s+`, tiny ordinal group) — ReDoS-safe. */
const WORD_DAY_RE = /([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/gi;

/** Parse "YYYY Date: Weekday, Month Day[ – Weekday, Month Day]" → start (+ end
 *  for a multi-day span). Returns null for "No Current Date" / unparseable. */
export function parseBfmDate(dateText: string): { date: string; endDate?: string } | null {
  const ym = YEAR_PREFIX_RE.exec(dateText);
  if (!ym) return null;
  const year = ym[1];
  const monthDays: Array<{ month: number; day: number }> = [];
  for (const m of dateText.slice(ym[0].length).matchAll(WORD_DAY_RE)) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) monthDays.push({ month, day: Number.parseInt(m[2], 10) });
  }
  if (monthDays.length === 0) return null;
  // toIsoDateString normalizes overflow (a "February 31st" typo would silently
  // roll to March 3), so round-trip: reject a day that landed on a different
  // month/day than the source stated — a source typo fails closed (skip) rather
  // than publishing a materially wrong marquee date. (Codex review)
  const iso = (md: { month: number; day: number }): string | null => {
    const s = toIsoDateString(`${year}-${md.month}-${md.day}`);
    const [, mm, dd] = s.split("-");
    return Number(mm) === md.month && Number(dd) === md.day ? s : null;
  };
  const date = iso(monthDays[0]);
  if (!date) return null;
  const end = monthDays.length > 1 ? iso(monthDays[monthDays.length - 1]) : null;
  return { date, endDate: end && end > date ? end : undefined };
}

/** Parse the special-events page: each bold medium-font paragraph is an event
 *  title; the next paragraph carries its date. Skips titles with no parseable
 *  date ("No Current Date"). */
export function parseBfmSpecialEvents(html: string): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $("p.has-medium-font-size").each((_i, el) => {
    const title = $(el).find("strong").text().replace(/\s+/g, " ").trim();
    if (!title) return;
    const dateText = $(el).nextAll("p").first().text().replace(/\s+/g, " ").trim();
    const parsed = parseBfmDate(dateText);
    if (!parsed) return;
    events.push({ date: parsed.date, endDate: parsed.endDate, title, kennelTags: [KENNEL_TAG] });
  });
  return events;
}

export class BfmSpecialEventsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let res: Response;
    try {
      res = await safeFetch(source.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracksBot/1.0)" } });
    } catch (err) {
      const message = `Failed to fetch BFM special events: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: source.url, message }] } };
    }
    if (!res.ok) {
      const message = `BFM special-events page error ${res.status}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: source.url, status: res.status, message }] } };
    }

    const parsed = parseBfmSpecialEvents(await res.text());
    // Structural guard: the page always lists several marquee events. Zero
    // parsed means the WordPress theme/markup changed — surface it (blocks
    // reconcile via the errors[] gate) rather than silently cancelling events.
    if (parsed.length === 0) {
      const message = "No BFM special events parsed — page structure may have changed";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    const events = filterEventsByWindow(parsed, options?.days ?? 365);

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: { eventsParsed: parsed.length, eventsInWindow: events.length },
    };
  }
}
