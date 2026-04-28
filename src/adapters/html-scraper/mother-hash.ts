import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { applyDateWindow, fetchHTMLPage, MONTHS, parse12HourTime, stripHtmlTags } from "../utils";

/**
 * Mother Hash (Kuala Lumpur Hash House Harriers) adapter.
 *
 * Mother Hash is the first hash kennel in the world — founded 30 November 1938
 * in Kuala Lumpur by Cecil Lee, "Horse" Thomson, "Torch" Bennett, and
 * A.S. Gispert at the Royal Selangor Club. Every other hash kennel in the
 * world descends from this one.
 *
 * motherhash.org is a static Google Sites page that exposes the next two
 * upcoming runs in a labeled paragraph format. The labels are bold spans
 * and the values are regular spans, but once HTML is stripped to plain
 * text the blocks collapse to a clean "Label: value" form:
 *
 *     Run #: 4250
 *     Date: 06-Apr-2026
 *     Run start: 6pm
 *     Hare: Henry Chia
 *     Run site: Broga
 *     GPS: 2.941198, 101.903586
 *     Type of run: Normal run
 *     Bomoh duty: Siew Kah Soon
 *     Scribe duty: Paul Bergmann
 *     Google maps: https://maps.app.goo.gl/...
 *     Waze: https://waze.com/ul/...
 *
 * We split the page text on "Run #:" anchors, extract labeled fields from
 * each block, and emit one RawEventData per run. GPS and Google Maps are
 * commonly "tbc" for the second (upcoming) run and are gracefully skipped.
 *
 * Two runs per scrape, manually updated.
 */

const KENNEL_TAG = "motherh3";
const SOURCE_URL_DEFAULT = "https://www.motherhash.org";

/** Label extraction helpers — each label gets its own single-line regex. */
const LABEL_PATTERNS = {
  runNumber: /Run\s*#:\s*(\d+)/i,
  date: /Date:\s*([0-9]{1,2}[-/][A-Za-z]{3,}[-/][0-9]{2,4})/i,
  runStart: /Run\s*start:\s*([^\n]+)/i,
  hare: /Hare:\s*([^\n]+)/i,
  runSite: /Run\s*site:\s*([^\n]+)/i,
  gps: /GPS:\s*([^\n]+)/i,
  googleMaps: /Google\s*maps:\s*(https?:\/\/\S+)/i,
  waze: /Waze:\s*(https?:\/\/\S+)/i,
} as const;

/**
 * Parse a date string like "06-Apr-2026" or "6-Apr-26" into "YYYY-MM-DD".
 * Uses the shared MONTHS map so "Jan"/"January"/"jan" all resolve.
 */
export function parseMotherHashDate(raw: string): string | null {
  const m = /^(\d{1,2})[-/]([A-Za-z]{3,})[-/](\d{2,4})$/.exec(raw.trim());
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  const month = MONTHS[monthName] ?? MONTHS[monthName.slice(0, 3)];
  if (!month) return null;
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a Mother Hash "Run start" cell like "6pm", "6:00 PM", "6.00pm" into HH:MM.
 * Falls back to the standard parse12HourTime helper when the value already
 * has minutes.
 */
export function parseMotherHashStartTime(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  // "6pm" (no minutes)
  const simple = /^(\d{1,2})\s*(am|pm)$/.exec(trimmed);
  if (simple) {
    let h = Number.parseInt(simple[1], 10);
    if (simple[2] === "pm" && h !== 12) h += 12;
    if (simple[2] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:00`;
  }
  // "6:00pm" / "6:00 pm"
  const fallback = parse12HourTime(trimmed);
  if (fallback) return fallback;
  return undefined;
}

/**
 * Parse a GPS cell like "2.941198, 101.903586" into a {latitude, longitude}
 * pair. Returns an empty object on "tbc" / "TBC" / missing coords.
 */
export function parseMotherHashGps(raw: string | undefined): { latitude?: number; longitude?: number } {
  if (!raw) return {};
  const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(raw);
  if (!m) return {};
  return {
    latitude: Number.parseFloat(m[1]),
    longitude: Number.parseFloat(m[2]),
  };
}

/**
 * Split the stripped page text into one block per run. Each block starts
 * at a "Run #:" anchor and runs until the next anchor (or end of text).
 *
 * Exported for unit testing.
 */
export function splitMotherHashBlocks(text: string): string[] {
  const anchors: number[] = [];
  const re = /Run\s*#:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    anchors.push(m.index);
  }
  if (anchors.length === 0) return [];
  const blocks: string[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i];
    const end = i + 1 < anchors.length ? anchors[i + 1] : text.length;
    blocks.push(text.slice(start, end));
  }
  return blocks;
}

/**
 * Parse a single "Run #:" block into a RawEventData. Returns null if the
 * block is missing the two required fields (run number + parseable date).
 *
 * Exported for unit testing.
 */
export function parseMotherHashBlock(block: string, sourceUrl: string): RawEventData | null {
  const runNumMatch = LABEL_PATTERNS.runNumber.exec(block);
  if (!runNumMatch) return null;
  const runNumber = Number.parseInt(runNumMatch[1], 10);

  const dateMatch = LABEL_PATTERNS.date.exec(block);
  if (!dateMatch) return null;
  const date = parseMotherHashDate(dateMatch[1]);
  if (!date) return null;

  const runStartMatch = LABEL_PATTERNS.runStart.exec(block);
  const startTime = runStartMatch ? parseMotherHashStartTime(runStartMatch[1]) : undefined;

  const hareMatch = LABEL_PATTERNS.hare.exec(block);
  const hares = hareMatch?.[1].trim() || undefined;

  const runSiteMatch = LABEL_PATTERNS.runSite.exec(block);
  const location = runSiteMatch?.[1].trim() || undefined;

  const gpsMatch = LABEL_PATTERNS.gps.exec(block);
  const { latitude, longitude } = parseMotherHashGps(gpsMatch?.[1]);

  const mapsMatch = LABEL_PATTERNS.googleMaps.exec(block);
  const locationUrl = mapsMatch?.[1];

  const wazeMatch = LABEL_PATTERNS.waze.exec(block);
  const externalLinks: { url: string; label: string }[] = [];
  if (wazeMatch) externalLinks.push({ url: wazeMatch[1], label: "Waze" });

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares,
    location,
    locationUrl,
    latitude,
    longitude,
    startTime,
    sourceUrl,
    externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
  };
}

export class MotherHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || SOURCE_URL_DEFAULT;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    // Strip HTML to paragraph-delimited plain text. Google Sites wraps each
    // labeled field in its own <p>, so stripHtmlTags("\n") gives us one
    // "Label: value" entry per line.
    const text = stripHtmlTags(page.html, "\n");
    const blocks = splitMotherHashBlocks(text);

    const events: RawEventData[] = [];
    for (const block of blocks) {
      const event = parseMotherHashBlock(block, url);
      if (event) events.push(event);
    }

    // Surface zero-result scrapes as scrape errors so the reconciler
    // doesn't cancel existing events when the Google Sites markup
    // drifts. Mother Hash always has at least the "next run" block
    // visible, so zero means the parser broke, not that the kennel
    // stopped running.
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    if (events.length === 0) {
      const message = "Mother Hash scraper parsed 0 runs — possible Google Sites format drift";
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
          blocksFound: blocks.length,
          eventsParsed: events.length,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
