import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, fetchHTMLPage, MONTHS } from "../utils";

const KENNEL_TAG = "bbh3";
const DEFAULT_URL = "https://hashcruise2020.simplesite.com/313623591";
const DEFAULT_DAYS = 450;
/** The hareline lists Sunday runs only; a different weekday means a typo or a bad year roll. */
const EXPECTED_WEEKDAY = "sunday";
const WEEKDAYS = new Set(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
const YEAR_RE = /\b(20\d{2})\b/;
const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Collapse whitespace (including NBSP) so token splitting is predictable. */
function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

/** First year in the list heading (`BBH3 (BASH) 2026 - 2027` → 2026), or null. */
export function readYearAnchor($: CheerioAPI): number | null {
  for (const el of $("h1, h2, h3, h4").toArray()) {
    const m = YEAR_RE.exec(clean($(el).text()));
    if (m) return Number.parseInt(m[1], 10);
  }
  return null;
}

export interface ParsedLine {
  month: number;
  day: number;
  weekday: string;
  hares?: string;
  title?: string;
}

/**
 * Parse one hareline line: `[#N ]<Weekday> <Month> <D>[ (theme)][ - hares]`.
 *
 * A leading `#N` is deliberately read and discarded. The page prints 13 run
 * numbers against 14 dates and the first row is unnumbered, so which number
 * belongs to which line is ambiguous in the source; a wrong run number on a
 * card is worse than none, and Harrier Central supplies the real one.
 * Returns null for lines that are not hareline rows (page notes, footers).
 */
export function parseLine(raw: string): ParsedLine | null {
  let text = clean(raw);
  if (text.startsWith("#")) {
    const space = text.indexOf(" ");
    if (space === -1) return null;
    text = text.slice(space + 1).trim();
  }
  const tokens = text.split(" ");
  if (tokens.length < 3) return null;
  const weekday = tokens[0].toLowerCase();
  const month = MONTHS[tokens[1].toLowerCase()];
  const day = /^\d{1,2}$/.test(tokens[2]) ? Number.parseInt(tokens[2], 10) : Number.NaN;
  if (!WEEKDAYS.has(weekday) || !month || !Number.isFinite(day)) return null;

  // Leading space so a separator directly after the date (`Dec 20 - Slow Poke`) still matches " - ".
  let tail = ` ${tokens.slice(3).join(" ")}`;
  let hares: string | undefined;
  let title: string | undefined;
  const dashAt = tail.indexOf(" - ");
  if (dashAt !== -1) {
    hares = tail.slice(dashAt + 3).trim() || undefined;
    tail = tail.slice(0, dashAt);
  }
  const open = tail.indexOf("(");
  const close = tail.lastIndexOf(")");
  if (open !== -1 && close > open) title = tail.slice(open + 1, close).trim() || undefined;
  return { month, day, weekday, hares, title };
}

/**
 * Parse every hareline row. Dates carry no year: start at the heading's year
 * and roll forward when the month decreases (Dec → Jan). Each row is
 * validated (real calendar date, Sunday); a failing row is skipped with an
 * error rather than guessed, so a mistyped row cannot poison later years.
 */
export function parseHareline(
  $: CheerioAPI,
  anchorYear: number,
  sourceUrl: string,
  defaultStartTime?: string,
): { events: RawEventData[]; errors: string[] } {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  let year = anchorYear;
  let prevMonth = 0;

  for (const el of $("p.textnormal").toArray()) {
    const parsed = parseLine($(el).text());
    if (!parsed) continue;
    if (prevMonth !== 0 && parsed.month < prevMonth) year += 1;
    prevMonth = parsed.month;

    const d = new Date(Date.UTC(year, parsed.month - 1, parsed.day, 12, 0, 0));
    const valid = d.getUTCMonth() === parsed.month - 1 && d.getUTCDate() === parsed.day;
    const isExpectedDay = valid && parsed.weekday === EXPECTED_WEEKDAY && d.getUTCDay() === 0;
    if (!isExpectedDay) {
      const label = `${parsed.weekday} ${parsed.month}/${parsed.day} (${year})`;
      console.warn(`[barbados-bike-hash] skipping row that is not a valid Sunday: ${label}`);
      errors.push(`Barbados Bike H3: row "${label}" is not a valid Sunday — skipped`);
      continue;
    }
    events.push({
      date: d.toISOString().slice(0, 10),
      kennelTags: [KENNEL_TAG],
      title: parsed.title,
      hares: parsed.hares,
      startTime: defaultStartTime,
      sourceUrl,
    });
  }
  return { events, errors };
}

/**
 * Barbados Bike H3 (BBH3 / "BASH") forward hareline, a single static page on
 * hashcruise2020.simplesite.com. Forward-only and edited in place, so
 * `Source.config.upcomingOnly` is required or reconcile would cancel rows as
 * they age off the page. Harrier Central (trust 8) remains the primary source
 * and supplies run numbers, venues and times once a run is posted there.
 */
export class BarbadosBikeHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const config = (source.config ?? {}) as { defaultStartTime?: unknown };
    const defaultStartTime =
      typeof config.defaultStartTime === "string" && HH_MM_RE.test(config.defaultStartTime)
        ? config.defaultStartTime
        : undefined;

    const anchorYear = readYearAnchor($);
    if (anchorYear === null) {
      return {
        events: [],
        errors: ["Barbados Bike H3: no year found in the hareline heading — markup may have changed"],
        structureHash,
        diagnosticContext: { fetchDurationMs, eventsParsed: 0 },
      };
    }

    const { events, errors } = parseHareline($, anchorYear, url, defaultStartTime);
    if (events.length === 0) {
      // Single page: zero rows means markup drift. Fail loud so reconcile can't cancel the future runs.
      errors.push("Barbados Bike H3: no hareline rows parsed — markup may have changed");
    }

    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, eventsParsed: events.length, anchorYear },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? DEFAULT_DAYS);
  }
}
