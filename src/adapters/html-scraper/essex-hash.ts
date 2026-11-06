/**
 * Essex H3 (Essex, England) HTML Scraper
 *
 * Scrapes essexhhh.co.uk/hareline — a GoDaddy Website Builder calendar widget,
 * fully server-rendered. GoDaddy rotates its opaque `c2-*` / `x-el-*` class
 * names on every publish, so parsing keys only on the stable `data-aid` hooks:
 *   CALENDAR_EVENT_DATE   "Monday 9th November 2026 - Run 2169"
 *   CALENDAR_EVENT_TITLE  venue + address + postcode (kept whole as location)
 *   CALENDAR_EVENT_TIME   "7pm" / "11am"
 *   CALENDAR_DESC_TEXT    <p> lines: a "Map" Google Maps link, an optional
 *                         "Hare(s) - X & Y" line, and free-text notes
 * Every run renders twice (CALENDAR_SMALLER_SCREEN_CONTAINER for mobile and
 * CALENDAR_BIGGER_SCREEN_CONTAINER for desktop); only the bigger container is
 * read, with a run-number dedup as a backstop.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, buildDateWindow, MONTHS } from "../utils";

const KENNEL_TAG = "essex-h3";
const DEFAULT_URL = "https://essexhhh.co.uk/hareline";

const RUN_RE = /\bRun\s+(\d{3,5})\b/i;
const DATE_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})\b/;
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
const HARES_RE = /^Hares?\s*[-:–]\s*(\S.*)$/i;

/** "Monday 9th November 2026 - Run 2169" → { date, runNumber } */
export function parseEssexHeading(text: string): { date: string; runNumber?: number } | null {
  const d = DATE_RE.exec(text);
  if (!d) return null;
  const month = MONTHS[d[2].toLowerCase()];
  if (!month) return null;
  const year = Number.parseInt(d[3], 10);
  const day = Number.parseInt(d[1], 10);
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const run = RUN_RE.exec(text);
  return {
    date: dt.toISOString().slice(0, 10),
    runNumber: run ? Number.parseInt(run[1], 10) : undefined,
  };
}

/** "7pm" → "19:00", "11am" → "11:00", "12pm" → "12:00" */
export function parseEssexTime(text: string): string | undefined {
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  let hour = Number.parseInt(m[1], 10);
  if (hour < 1 || hour > 12) return undefined;
  const pm = m[3].toLowerCase() === "pm";
  if (pm && hour !== 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${m[2] ?? "00"}`;
}

function clean(text: string): string {
  return text.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

/** Parse every run card in the desktop calendar container. Exported for tests. */
export function parseEssexHareline(html: string, sourceUrl = DEFAULT_URL): RawEventData[] {
  const $ = cheerio.load(html);
  const byRun = new Map<string, RawEventData>();

  $('[data-aid="CALENDAR_BIGGER_SCREEN_CONTAINER"]').each((_i, container) => {
    const $c = $(container);
    const heading = parseEssexHeading(clean($c.find('[data-aid="CALENDAR_EVENT_DATE"]').first().text()));
    if (!heading) return;

    const $desc = $c.find('[data-aid="CALENDAR_DESC_TEXT"]').first();
    const mapHref = $desc.find("a[href]").filter((_j, a) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test($(a).attr("href") ?? "")).first().attr("href");
    let hares: string | undefined;
    const notes: string[] = [];
    $desc.find("p").each((_j, p) => {
      const $p = $(p).clone();
      $p.find("a").remove();
      const line = clean($p.text());
      if (!line) return;
      const h = HARES_RE.exec(line);
      if (h) hares = h[1];
      else notes.push(line);
    });

    const location = clean($c.find('[data-aid="CALENDAR_EVENT_TITLE"]').first().text());
    const event: RawEventData = {
      date: heading.date,
      kennelTags: [KENNEL_TAG],
      runNumber: heading.runNumber,
      startTime: parseEssexTime(clean($c.find('[data-aid="CALENDAR_EVENT_TIME"]').first().text())),
      location: location || undefined,
      locationUrl: mapHref,
      hares,
      description: notes.length > 0 ? notes.join("\n") : undefined,
      sourceUrl,
    };
    const key = heading.runNumber === undefined ? `${heading.date}|${location}` : String(heading.runNumber);
    if (!byRun.has(key)) byRun.set(key, event);
  });

  return [...byRun.values()];
}

export class EssexHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const parsed = parseEssexHareline(html, sourceUrl);
    if (parsed.length === 0) {
      return {
        events: [],
        errors: ["Essex H3: 0 runs parsed from the hareline calendar — markup drift"],
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
      diagnosticContext: { runsParsed: parsed.length, eventsInWindow: events.length, fetchDurationMs },
    };
  }
}
