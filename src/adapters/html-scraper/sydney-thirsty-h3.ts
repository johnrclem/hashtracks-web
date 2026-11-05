import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import type { CheerioAPI } from "cheerio";
import {
  applyDateWindow,
  chronoParseDate,
  EMOJI_RE,
  fetchHTMLPage,
  parse12HourTime,
  stripPlaceholder,
  WEEKDAY_NAMES,
} from "../utils";

/**
 * Sydney Thirsty H3 — sth3.org
 *
 * The "Upcoming Runs" page is a Google Sites page whose run content is
 * server-rendered (plain Cheerio works). The Nov-2026 redesign moved each run
 * into heading blocks:
 *
 *   <h2>🍺 🏃 Thursday 5 November — 6:30pm 🍺 🏃</h2>        ← date + time
 *   <h3>Run #1881<br>Lavendar Hash<br>Clark Park, Lavender Bay</h3>
 *   <h3><a href="https://maps.app.goo.gl/…">Open in Google Maps</a></h3>
 *
 * Google Sites splits text across spans arbitrarily ("Run #188" + "2",
 * "2\n:\n0\n0pm"), every heading carries a "Copy heading link" anchor, and
 * the maps link sometimes sits inside the Run heading. Classes rotate, so the
 * parser keys on content shape only:
 *   - each block element (p / h1–h6) becomes lines split on <br>, with span
 *     fragments joined and the copy-link anchor ignored;
 *   - a line that parses as "<weekday> <day> <month>" opens a run block;
 *   - the first "Run #N" line (or "Runs … N & M") gives the run number(s);
 *     the remaining lines of that element are [title, venue] (2 lines) or
 *     [venue] (1 line); "Location TBC" placeholders are dropped;
 *   - the first external (non-#) link in the block is the maps URL;
 *   - any other element closes the block (the page's prose sections).
 */

const KENNEL_TAG = "sth3-au";
const SOURCE_URL_DEFAULT = "https://www.sth3.org/upcoming-runs";

const MAP_BOILERPLATE_PHRASE = "at the map location below";

function stripTrailingCommas(value: string): string {
  let s = value;
  while (s.endsWith(",")) s = s.slice(0, -1).trimEnd();
  return s;
}

/**
 * Strip the "…, at the map location below." tail older run blocks appended to
 * the venue. Also used by scripts/cleanup-ws5-canonical-ghosts.ts.
 */
export function stripMapBoilerplate(value: string): string {
  let s = value.trimEnd();
  if (s.endsWith(".")) s = s.slice(0, -1).trimEnd();
  if (s.toLowerCase().endsWith(MAP_BOILERPLATE_PHRASE)) {
    s = s.slice(0, -MAP_BOILERPLATE_PHRASE.length).trimEnd();
    s = stripTrailingCommas(s);
  }
  return s;
}

/** One block element of the page, as text lines + its first external link. */
export interface ThirstyElement {
  lines: string[];
  href?: string;
}

const WEEKDAY_DATE_RE =
  /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\b/i;
const RUN_LINE_RE = /^Run\s*#\s*(\d+)/i;
const MULTI_RUN_RE = /^Runs?\b\D*(\d+)(?:\s*(?:&|and)\s*(\d+))?/i;
const MAPS_LINK_TEXT_RE = /^(?:Open in Google Maps|Map(?::.*)?|TBC|here)$/i;

/** Strip emoji / decoration and collapse whitespace. */
function cleanLine(text: string): string {
  return text.replace(EMOJI_RE, " ").replaceAll(/\s+/g, " ").trim();
}

/**
 * Turn the page into a flat list of block elements. Text inside one element is
 * split on <br> into lines; inline span fragments are concatenated, so
 * "Run #188" + "2" reads "Run #1882" and "2:00pm" survives span splitting.
 *
 * Exported for unit testing.
 */
export function extractThirstyElements($: CheerioAPI): ThirstyElement[] {
  const elements: ThirstyElement[] = [];
  $("[role='main']")
    .find("p, h1, h2, h3, h4, h5, h6")
    .each((_i, el) => {
      const $el = $(el).clone();
      $el.find("[aria-label='Copy heading link'], svg").remove();
      const href = $el
        .find("a[href]")
        .toArray()
        .map((a) => $(a).attr("href") ?? "")
        .find((h) => /^https?:\/\//i.test(h));
      $el.find("br").replaceWith("\n");
      const lines = $el
        .text()
        .split("\n")
        .map(cleanLine)
        .filter((l) => l.length > 0);
      if (lines.length > 0) elements.push({ lines, href });
    });
  return elements;
}

/** Resolve "Thursday 5 November" to a date whose weekday matches (this year, next or last). */
export function resolveThirstyDate(line: string, referenceDate: Date): string | undefined {
  const m = WEEKDAY_DATE_RE.exec(line);
  if (!m) return undefined;
  const forward = chronoParseDate(`${m[1]} ${m[2]}`, "en-GB", referenceDate, { forwardDate: true });
  if (!forward) return undefined;
  const weekday = line.slice(0, m.index + m[0].length).match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i)?.[1];
  if (!weekday) return forward;
  const want = WEEKDAY_NAMES[weekday.slice(0, 2).toUpperCase()];
  // forwardDate may roll a just-passed run into next year; prefer the candidate
  // whose weekday matches the heading.
  const [y, mo, d] = forward.split("-").map(Number);
  for (const year of [y, y - 1, y + 1]) {
    const dt = new Date(Date.UTC(year, mo - 1, d, 12));
    if (dt.getUTCDate() === d && dt.getUTCDay() === want) return dt.toISOString().slice(0, 10);
  }
  return forward;
}

/** "Run #1881" → [1881]; "Runs (Sat and Sun) 1843 & 1844" → [1843, 1844]; else null. */
function parseRunNumbers(line: string): number[] | null {
  const single = RUN_LINE_RE.exec(line);
  if (single) return [Number.parseInt(single[1], 10)];
  const multi = MULTI_RUN_RE.exec(line);
  if (!multi) return null;
  return multi[2] ? [Number.parseInt(multi[1], 10), Number.parseInt(multi[2], 10)] : [Number.parseInt(multi[1], 10)];
}

interface RunBlock {
  dateLine: string;
  date: string;
  runNumbers: number[];
  details: string[];
  href?: string;
}

function blockToEvents(block: RunBlock, sourceUrl: string): RawEventData[] {
  if (block.runNumbers.length === 0) return [];
  const details = block.details.filter((l) => !MAPS_LINK_TEXT_RE.test(l));
  const venueRaw = details.length > 0 ? details.at(-1) : undefined;
  const venue = venueRaw ? stripPlaceholder(stripMapBoilerplate(venueRaw.replace(/^Location:\s*/i, ""))) : undefined;
  const title = details.length >= 2 ? details[0] : undefined;
  const location = venue && !/^Location\s+TBC$/i.test(venue) ? venue : undefined;
  return block.runNumbers.map((runNumber) => ({
    date: block.date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    title,
    location,
    // A "TBC" venue keeps a stale placeholder link (live: #1883 reuses #1881's pin).
    locationUrl: location ? block.href : undefined,
    startTime: parse12HourTime(block.dateLine),
    sourceUrl,
  }));
}

/**
 * Walk the page's block elements and emit one event per run number.
 * Exported for unit testing.
 */
export function parseThirstyElements(
  elements: ThirstyElement[],
  sourceUrl: string,
  referenceDate: Date = new Date(),
): RawEventData[] {
  const events: RawEventData[] = [];
  let block: RunBlock | undefined;
  const close = () => {
    if (block) events.push(...blockToEvents(block, sourceUrl));
    block = undefined;
  };

  for (const el of elements) {
    const date = el.lines.length === 1 ? resolveThirstyDate(el.lines[0], referenceDate) : undefined;
    if (date) {
      close();
      block = { dateLine: el.lines[0], date, runNumbers: [], details: [] };
      continue;
    }
    if (!block) continue;

    if (block.runNumbers.length === 0) {
      const runIdx = el.lines.findIndex((l) => parseRunNumbers(l) !== null);
      if (runIdx === -1) {
        close();
        continue;
      }
      block.runNumbers.push(...(parseRunNumbers(el.lines[runIdx]) ?? []));
      block.details.push(...el.lines.slice(runIdx + 1));
      block.href ??= el.href;
      continue;
    }

    // After the Run line, only a maps-link element still belongs to the run.
    if (el.href && el.lines.every((l) => MAPS_LINK_TEXT_RE.test(l))) {
      block.href ??= el.href;
      continue;
    }
    close();
  }
  close();
  return events;
}

export class SydneyThirstyH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || SOURCE_URL_DEFAULT;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const elements = extractThirstyElements(page.$);
    const events = parseThirstyElements(elements, url);

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    if (events.length === 0) {
      const message = "Sydney Thirsty H3 scraper parsed 0 runs — possible site format drift";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    const days = options?.days ?? source.scrapeDays ?? 180;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: errors.length > 0 ? errorDetails : undefined,
        structureHash: page.structureHash,
        diagnosticContext: {
          fetchMethod: "html-scrape",
          elementsFound: elements.length,
          eventsParsed: events.length,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
