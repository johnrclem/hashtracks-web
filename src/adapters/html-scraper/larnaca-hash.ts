/**
 * Larnaca Hash House Harriers (LH3-CY) — first 🇨🇾 Cyprus kennel (est. May 1987).
 *
 * Scrapes the Google Sites "NEXT RUN" page
 * (sites.google.com/view/larnaca-hash-house-harriers/next-run), which is fully
 * server-rendered. Google Sites rotates its class names, so the parse is keyed on
 * content: every paragraph (`<p>`) is one text line, and Apple tab spans keep the
 * column gaps as `\t`. Two surfaces:
 *
 *   1. The current-run block — labelled lines ("RUN NUMBER:-", "HARES :-",
 *      "LOCATION :-", "DATE :-", "TIME :- HASH AT 1600 …", "What3words:///a.b.c").
 *   2. The "Future Hares:-" list — one tab-delimited line per run:
 *      `<run>\t<09th Nov 26>\t<hares…>\t<location>\t<on-on>`. Hare pairs are
 *      sometimes split across cells ("Sian the Sheep\t+\tOpen Wide").
 *
 * The list is the event set; the matching current-run row is enriched with the
 * block's start time, venue and what3words link. Dates are year-bearing (2-digit
 * year in the list), so no year inference. Titles stay undefined → merge
 * synthesizes "Larnaca H3 Trail #N". The list is a rolling forward window, so the
 * source ships `upcomingOnly: true`.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import { fetchHTMLPage, filterEventsByWindow } from "../utils";

const KENNEL_TAG = "lh3-cy";
const DEFAULT_URL = "https://sites.google.com/view/larnaca-hash-house-harriers/next-run";
const FUTURE_HEADING = "future hares";

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);

// "09th Nov 26", "22nd Feb27", "31st August 2026". Bounded quantifiers only.
const DATE_RE = /(\d{1,2})(?:st|nd|rd|th)? ?([A-Za-z]{3,9}) ?(\d{4}|\d{2})\b/;
const RUN_LINE_RE = /^(\d{3,5})\t/;
const HASH_AT_RE = /\bhash at (\d{1,2})[.:]?(\d{2})\b/i;
const W3W_RE = /\/\/\/([a-z]{1,30}\.[a-z]{1,30}\.[a-z]{1,30})/i;
const PLACEHOLDERS = new Set(["", "tba", "tbc", "tbd", "none"]);

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/ {2,}/g, " ").trim();
}

/** Parse "09th Nov 26" / "31st August 2026" to "YYYY-MM-DD"; null if malformed. */
export function parseLarnacaDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const month = MONTHS.get(m[2].slice(0, 3).toLowerCase());
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Split hare cells ("A and B", "A", "+", "B") into a sorted "A, B". A cell that
 * is present but only a placeholder ("TBA") returns null, so merge clears a
 * previously named hare (atomic-bundle semantics).
 */
export function splitHares(parts: string[]): string | null {
  const names = parts
    .join(",")
    .replaceAll(" and ", ",")
    .replaceAll(" & ", ",")
    .replaceAll("+", ",")
    .split(",")
    .map((s) => clean(s))
    .filter((s) => s && !PLACEHOLDERS.has(s.toLowerCase()));
  if (names.length === 0) return null;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Present placeholder ("TBA", "None") → null (explicit clear); absent → undefined. */
function placeholderOrValue(text: string | undefined): string | null | undefined {
  if (text === undefined) return undefined;
  const v = clean(text);
  return PLACEHOLDERS.has(v.toLowerCase()) ? null : v;
}

/** One "Future Hares" line → event; null for non-run lines. Throws on a bad date. */
export function parseFutureLine(line: string, sourceUrl: string): RawEventData | null {
  const run = RUN_LINE_RE.exec(line);
  if (!run) return null;
  const cells = line.split("\t").map(clean).filter(Boolean);
  // cells: [run, date, ...hares, location, onOn]. Gaps are runs of tabs, so an
  // empty cell vanishes; with only 4 cells we can't tell whether the venue or
  // the On On is the missing one, so the venue is left unset rather than guessed.
  if (cells.length < 4) throw new Error(`run ${run[1]}: too few columns`);
  const date = parseLarnacaDate(cells[1]);
  if (!date) throw new Error(`run ${run[1]}: unparseable date "${cells[1]}"`);
  const ambiguous = cells.length === 4;
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: Number.parseInt(run[1], 10),
    hares: splitHares(ambiguous ? [cells[2]] : cells.slice(2, -2)),
    location: ambiguous ? undefined : placeholderOrValue(cells.at(-2)),
    sourceUrl,
  };
}

/** "16","00" → "16:00"; undefined when out of range ("16","60"). */
function toClock(hours: string, minutes: string): string | undefined {
  const h = Number.parseInt(hours, 10);
  const m = Number.parseInt(minutes, 10);
  if (h > 23 || m > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${minutes}`;
}

export interface CurrentRunBlock {
  runNumber?: number;
  date?: string;
  hares?: string | null;
  location?: string | null;
  startTime?: string;
  locationUrl?: string;
}

/** Value after a "LABEL :-" prefix, or undefined if the line has a different label. */
function labelValue(line: string, label: string): string | undefined {
  const upper = line.toUpperCase();
  if (!upper.startsWith(label)) return undefined;
  const dash = line.indexOf(":-");
  if (dash < 0) return undefined;
  return clean(line.slice(dash + 2));
}

/** Parse the labelled current-run block from the lines above "Future Hares". */
export function parseCurrentBlock(lines: string[]): CurrentRunBlock {
  const block: CurrentRunBlock = {};
  for (const line of lines) {
    const run = labelValue(line, "RUN NUMBER");
    if (run) block.runNumber = Number.parseInt(run, 10) || undefined;
    const hares = labelValue(line, "HARES");
    if (hares) block.hares = splitHares([hares]);
    const loc = labelValue(line, "LOCATION");
    if (loc) block.location = placeholderOrValue(loc);
    const date = labelValue(line, "DATE");
    if (date) block.date = parseLarnacaDate(date) ?? undefined;
    const time = labelValue(line, "TIME");
    const hashAt = time ? HASH_AT_RE.exec(time) : null;
    if (hashAt) block.startTime = toClock(hashAt[1], hashAt[2]);
    const w3w = line.toLowerCase().startsWith("what3words") ? W3W_RE.exec(line) : null;
    if (w3w) block.locationUrl = `https://what3words.com/${w3w[1].toLowerCase()}`;
  }
  return block;
}

/** Parse the whole page. Exported for tests. */
export function parseLarnacaPage(
  html: string,
  sourceUrl = DEFAULT_URL,
): { events: RawEventData[]; foundList: boolean; parseErrors: ParseError[] } {
  const $ = cheerio.load(html);
  const lines = $("p")
    .toArray()
    .map((p) => $(p).text().replaceAll(" ", " "))
    .filter((l) => l.trim().length > 0);

  const headingIdx = lines.findIndex((l) => l.trim().toLowerCase().startsWith(FUTURE_HEADING));
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];
  if (headingIdx < 0) return { events, foundList: false, parseErrors };

  lines.slice(headingIdx + 1).forEach((line, i) => {
    try {
      const event = parseFutureLine(line.trim(), sourceUrl);
      if (event) events.push(event);
    } catch (err) {
      parseErrors.push({
        row: i,
        section: "future-hares",
        error: `LH3-CY: ${err instanceof Error ? err.message : String(err)}`,
        rawText: line.slice(0, 200),
      });
    }
  });

  const block = parseCurrentBlock(lines.slice(0, headingIdx));
  const current = events.find(
    (e) => (block.runNumber && e.runNumber === block.runNumber) || (block.date && e.date === block.date),
  );
  if (current) {
    if (block.startTime) current.startTime = block.startTime;
    if (block.location) current.location = block.location;
    if (block.locationUrl) current.locationUrl = block.locationUrl;
    if (block.hares) current.hares = block.hares;
  } else if (block.date && block.runNumber) {
    // The block's run was already dropped from the list: emit it from the block
    // so it isn't silently lost.
    events.unshift({
      date: block.date,
      kennelTags: [KENNEL_TAG],
      runNumber: block.runNumber,
      hares: block.hares,
      location: block.location,
      startTime: block.startTime,
      locationUrl: block.locationUrl,
      sourceUrl,
    });
  }
  return { events, foundList: true, parseErrors };
}

export class LarnacaHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { events, foundList, parseErrors } = parseLarnacaPage(page.html, url);
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    const errors = parseErrors.map((p) => p.error);
    // Fail loud on drift: a missing heading or an empty list (the kennel posts
    // ~4 months of future hares) means the page changed shape.
    if (!foundList) errors.push(`LH3-CY: "Future Hares" heading not found at ${url}`);
    else if (events.length === 0) errors.push(`LH3-CY: no runs parsed under "Future Hares" at ${url}`);

    return {
      events: windowed,
      errors,
      structureHash: page.structureHash,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      diagnosticContext: {
        totalBeforeFilter: events.length,
        eventsParsed: windowed.length,
        fetchDurationMs: page.fetchDurationMs,
      },
    };
  }
}
