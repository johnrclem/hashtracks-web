import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, fetchHTMLPage, MONTHS } from "../utils";

const DEFAULT_URL = "https://nwh3.net/runsheet.html";

/** Trailing `run 2071` on the date line. */
const RUN_RE = /\brun (\d{2,4})\s*$/i;
/** Moonrakers sheet: `04/11/26`. */
const SLASH_DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2})\b/;
/** Sunday sheet: `08 November 2026` (optionally after a weekday word). */
const LONG_DATE_RE = /(\d{1,2}) ([A-Za-z]+),? (\d{4})/;
/** `11am`, `7pm`, `7.30pm`, `10:30am`, `12 noon`, `12noon`, `1.30 pm`. */
const TIME_RE = /(\d{1,2})(?:[.:](\d{2}))? ?(am|pm|noon)\b/i;
const PLACEHOLDERS = new Set(["TBA", "TBC", "TBD", "FREE", ""]);

function clean(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function trimCommas(text: string): string {
  let out = text.trim();
  while (out.endsWith(",")) out = out.slice(0, -1).trim();
  return out;
}

function orUndefined(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const value = trimCommas(clean(text));
  return PLACEHOLDERS.has(value.toUpperCase()) ? undefined : value;
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

export function parseSheetDate(text: string): string | null {
  const slash = SLASH_DATE_RE.exec(text);
  if (slash) {
    return isoDate(2000 + Number.parseInt(slash[3], 10), Number.parseInt(slash[2], 10), Number.parseInt(slash[1], 10));
  }
  const long = LONG_DATE_RE.exec(text);
  if (!long) return null;
  const month = MONTHS[long[2].toLowerCase()];
  if (!month) return null;
  return isoDate(Number.parseInt(long[3], 10), month, Number.parseInt(long[1], 10));
}

export function parseSheetTime(text: string): string | undefined {
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  let hour = Number.parseInt(m[1], 10);
  const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
  const suffix = m[3].toLowerCase();
  if (suffix === "noon") return hour === 12 ? "12:00" : undefined;
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Text lines of a `<li>` (its `<br>`s become line breaks). */
function itemLines($: CheerioAPI, li: unknown): string[] {
  const $li = $(li as never).clone();
  $li.find("br").replaceWith("\n");
  $li.find("a").remove();
  return $li.text().split("\n").map(clean).filter(Boolean);
}

/**
 * Parse a run sheet (or yearly run-records page) — repeated
 * `div.runList` blocks: `li.runDate` ("08 November 2026 at 11am, run 2071" /
 * "04/11/26 at 7pm, run 757") followed by three `li.runItem`s: venue (a
 * `<br>`-appended second line is a theme → title), address/town (+ map link),
 * hares. TBA/TBC/FREE placeholders map to undefined.
 */
export function parseRunSheet($: CheerioAPI, kennelTag: string, sourceUrl: string): RawEventData[] {
  const events: RawEventData[] = [];
  $("div.runList").each((_i, block) => {
    const $block = $(block);
    const dateText = clean($block.find("li.runDate").first().text());
    const run = RUN_RE.exec(dateText);
    const date = parseSheetDate(dateText);
    if (!run || !date) return;

    const items = $block.find("li.runItem").toArray();
    const venueLines = items[0] ? itemLines($, items[0]) : [];
    const addressLines = items[1] ? itemLines($, items[1]) : [];
    const hareLines = items[2] ? itemLines($, items[2]) : [];
    const mapHref = $(items[1] as never).find('a[href*="google"]').attr("href");
    // A single venue line that names a run ("Xmas Jumper Run", "Boxing Day Run")
    // is the event's theme, not a place.
    const venueIsTheme = venueLines.length === 1 && venueLines[0].toLowerCase().endsWith(" run");

    events.push({
      date,
      kennelTags: [kennelTag],
      runNumber: Number.parseInt(run[1], 10),
      startTime: parseSheetTime(dateText),
      title: orUndefined((venueIsTheme ? venueLines[0] : venueLines.slice(1).join(" ")) || undefined),
      location: venueIsTheme ? undefined : orUndefined(venueLines[0]),
      locationStreet: orUndefined(addressLines.join(", ") || undefined),
      locationUrl: mapHref,
      hares: orUndefined(hareLines.join(" ") || undefined),
      sourceUrl,
    });
  });
  return events;
}

/**
 * North Wilts H3 (Swindon) run sheets on nwh3.net. One adapter serves two
 * sources with the same nested-`<ul>` markup: the weekly Sunday sheet
 * (`runsheet.html`, kennel nwh3) and the fortnightly Wednesday Moonrakers
 * sheet (`moonrakers.html`, kennel nwh3-moon). The kennel comes from
 * `Source.config.kennelTag`. Forward-only sheets → `upcomingOnly`.
 */
export class NorthWiltsHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const config = (source.config ?? {}) as { kennelTag?: unknown };
    const kennelTag = typeof config.kennelTag === "string" ? config.kennelTag : undefined;
    if (!kennelTag) {
      return { events: [], errors: ["North Wilts H3: Source.config.kennelTag is required"] };
    }

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events = parseRunSheet($, kennelTag, url);
    const errors: string[] = [];
    if (events.length === 0) {
      errors.push(`North Wilts H3 (${kennelTag}): 0 runs parsed from ${url} — markup may have changed`);
    }
    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, eventsParsed: events.length },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? 365);
  }
}
