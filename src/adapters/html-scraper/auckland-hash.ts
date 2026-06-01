import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  fetchHTMLPage,
  chronoParseDate,
  filterEventsByWindow,
  normalizeHaresField,
  cleanLocationName,
} from "../utils";

const DEFAULT_URL = "http://www.aucklandhashhouseharriers.co.nz/";
const KENNEL_TAG = "ah3-nz";

/** Club default — "All runs start at 6:30 PM, unless stated otherwise". */
const DEFAULT_START_TIME = "18:30";

/**
 * A run row starts with a `D-MMM-YY` date (e.g. `1-Jun-26`, `13-Jul-26`).
 * Single simple shape — no month-name enumeration (chrono validates the
 * matched slice). Linear, ReDoS-safe (Sonar S5852/S5843).
 */
const DATE_START_RE = /^\d{1,2}-[A-Za-z]{3}-\d{2}\b/;

/** Hare placeholder for an unassigned trail — emit no hare, no title. */
const HARE_WANTED_RE = /^hare\s+wanted$/i;

/** A bare clock time with an am/pm marker, e.g. `4pm Start` → 16:00. */
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b/i;

/**
 * Locate the "Upcoming Runs" text. The homepage is a Rocketspark site whose
 * run list lives in a Draft.js content block (`.public-DraftEditor-content`)
 * as TAB-delimited text (`<date>\t<hare>\t<venue>`), NOT a table. Key on the
 * block's content ("Upcoming Runs") rather than rotating Rocketspark class
 * names; fall back to whole-document text if the block class ever changes.
 */
export function extractUpcomingText($: cheerio.CheerioAPI): string {
  let found = "";
  $(".public-DraftEditor-content").each((_, el) => {
    const text = $(el).text();
    if (/Upcoming Runs/i.test(text)) found = text;
  });
  return found || $.root().text();
}

/**
 * Split the block text into one string per run. Rows are newline-separated,
 * but long venues wrap onto continuation lines (leading whitespace, no leading
 * date) — those are folded back into the preceding row. A blank line closes the
 * current row to further continuation, so trailing junk (e.g. a stray `- `
 * after the last run) is never appended to a real venue.
 */
export function groupRunRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let canAppend = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (DATE_START_RE.test(line)) {
      if (current) rows.push(current);
      // Strip only leading whitespace — a trailing tab is structural (it marks
      // an empty venue, e.g. "Hare Wanted\t"), so trimming it would drop the
      // third field and trip parseRunLine's delimiter-drift guard. Per-field
      // trimming happens in parseRunLine.
      current = rawLine.trimStart();
      canAppend = true;
    } else if (line === "") {
      canAppend = false;
    } else if (canAppend && current) {
      current += ` ${line}`;
    }
  }
  if (current) rows.push(current);
  return rows;
}

/**
 * Parse a stated start time from the venue/notes tail. Defaults to 6:30 PM
 * when no `am`/`pm` marker is present (street numbers like "7 Litten" won't
 * match — the meridiem marker is required). Flat regex (Sonar-safe).
 */
export function parseStartTime(notes: string): string {
  const match = TIME_RE.exec(notes);
  if (!match) return DEFAULT_START_TIME;
  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const meridiem = match[3].toLowerCase();
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return DEFAULT_START_TIME;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse one TAB-delimited run row (`<date>\t<hare>\t<venue/notes>`) into
 * RawEventData. The tab delimiter makes multi-word hares ("Loose Change",
 * "Hard to Port") unambiguous — no greedy boundary heuristic needed. Returns
 * null when the leading token isn't a parseable date (caller records an error
 * so the row failure suppresses reconcile rather than silently dropping).
 */
export function parseRunLine(
  row: string,
  referenceDate = new Date(),
  sourceUrl = DEFAULT_URL,
): RawEventData | null {
  const parts = row.split("\t").map((p) => p.trim());
  const dateRaw = parts[0] ?? "";
  const date = chronoParseDate(dateRaw.replaceAll("-", " "), "en-GB", referenceDate, {
    forwardDate: true,
  });
  if (!date) return null;

  // The source emits a fixed `<date>\t<hare>\t<venue>` shape — the venue tab is
  // present even when the venue is blank ("Hare Wanted\t"). Fewer than three
  // tab fields means the tab delimiters drifted; fail loud (null → caller
  // records an error → reconcile suppressed) rather than silently mis-binding
  // venue text as the hare.
  if (parts.length < 3) return null;

  const hareRaw = parts[1] ?? "";
  const hares = HARE_WANTED_RE.test(hareRaw)
    ? undefined
    : normalizeHaresField(hareRaw);

  const venue = parts.slice(2).join(" ").replaceAll(/\s+/g, " ").trim();
  // cleanLocationName returns null for placeholders ("Venue TBC"), CTA copy,
  // and empties — the source always provides the venue field, so null is the
  // correct explicit-clear (not undefined). Real venues pass through verbatim.
  const location = cleanLocationName(venue);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    // Leave title undefined — merge.ts synthesizes "Auckland H3 Trail". No run
    // numbers exist on this source, so no runNumber is emitted.
    hares,
    location,
    startTime: parseStartTime(venue),
    sourceUrl,
  };
}

/**
 * Auckland Hash House Harriers (Auckland H3) — New Zealand's oldest hash club
 * (est. 25 Aug 1970). Scrapes the rolling "Upcoming Runs" list on the
 * Rocketspark homepage. Server-rendered (Cheerio; no browser render). The list
 * is a Draft.js content block of TAB-delimited rows; venues occasionally wrap
 * onto continuation lines. No run numbers, no archive, no pagination — a
 * future-only rolling list (the source is seeded `upcomingOnly: true`).
 */
export class AucklandHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const referenceDate = new Date();
    const rows = groupRunRows(extractUpcomingText($));

    const addParseError = (row: number, error: string, rawText: string) => {
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row, section: "upcoming-runs", error, rawText: rawText.slice(0, 2000) },
      ];
    };

    rows.forEach((row, i) => {
      try {
        const event = parseRunLine(row, referenceDate, url);
        if (event) {
          events.push(event);
        } else {
          // A run-shaped row that won't parse (e.g. a typo'd date) is a hard
          // signal, not noise: surface it in errors[] so scrape.ts suppresses
          // the destructive reconcile rather than CANCELLING a live event.
          errors.push(`Unparseable run row ${i}: ${row.slice(0, 120)}`);
          addParseError(i, "Could not parse run row", row);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        addParseError(i, String(err), row);
      }
    });

    const filtered = filterEventsByWindow(events, options?.days ?? 365);

    return {
      events: filtered,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: filtered.length,
        totalBeforeFilter: events.length,
        fetchDurationMs,
      },
    };
  }
}
