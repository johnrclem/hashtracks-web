import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { fetchWordPressComPage } from "../wordpress-api";
import { MONTHS, decodeEntities, buildDateWindow, stripHtmlTags } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";

const DEFAULT_SITE_DOMAIN = "hashhousehorrors.com";
const HARELINE_SLUG = "hareline";
const KENNEL_TAG = "hhhorrors";
const DEFAULT_START_TIME = "16:30";

/**
 * Hash House Horrors (Singapore) adapter.
 *
 * The kennel uses a WordPress.com hosted blog (NOT self-hosted), so the
 * standard `/wp-json/` endpoint returns 404. Instead we use the WordPress.com
 * Public REST API to fetch the `/hareline` page (page id 18, "Previous Runs"),
 * which contains the entire run history grouped by year.
 *
 * Format inside the page content:
 *
 *   2026
 *   1016 – May 17 – Wade Family
 *   1015 – May 3 – Baudoux, Guthrie and Poyner Families
 *   1014 – April 19 – Hares Needed
 *   1013 – April 5 – Campbell Family
 *   ...
 *   2025
 *   1006 – December 14 – Dew, Jones, Petrocelli and Waage Families – Bukit Batok East Avenue 2 Heavy Vehicle Park
 *   ...
 *
 * - Year sections (`2026`, `2025`, ...) act as parser anchors
 * - Per-run line: `<runNumber> – <month> <day> – <hares>[ – <location>]`
 * - "Hares Needed" sentinel for unfilled future runs (drop the value)
 * - Some lines omit the location
 *
 * Children's hash, biweekly Sundays starting 4:30 PM.
 */

// Match en-dash, em-dash, and ASCII hyphen as field separators (the live page
// uses en-dash, but defensive coverage in case the kennel changes formatting).
const RUN_LINE_RE = /^(\d{3,4})\s*[–—-]\s*([a-z]+)\s+(\d{1,2})(?:\s*[–—-]\s*(.+))?$/i;

interface ParsedRunLine {
  runNumber: number;
  monthIdx: number;
  day: number;
  hares?: string;
  location?: string;
}

/** Parse a single line like "1016 – May 17 – Wade Family – Pearl Hill". */
export function parseHashHorrorsRunLine(line: string): ParsedRunLine | null {
  const cleaned = line.trim();
  const m = RUN_LINE_RE.exec(cleaned);
  if (!m) return null;

  const runNumber = Number.parseInt(m[1], 10);
  const monthIdx = MONTHS[m[2].toLowerCase()];
  if (!monthIdx) return null;
  const day = Number.parseInt(m[3], 10);
  if (day < 1 || day > 31) return null;

  // Split tail on the LAST dash so multi-family hare lists with internal "–"
  // don't get sliced. Cover all three dash characters used in the wild.
  const tail = m[4]?.trim();
  let hares: string | undefined;
  let location: string | undefined;
  if (tail) {
    // Split on any dash variant (en/em/hyphen) surrounded by spaces. The last
    // match separates hares from location; earlier dashes are part of a
    // multi-family hare list.
    const dashRe = /\s+[–—-]\s+/g;
    let lastIdx = -1;
    let lastLen = 0;
    for (const dm of tail.matchAll(dashRe)) {
      lastIdx = dm.index ?? -1;
      lastLen = dm[0].length;
    }
    if (lastIdx > 0) {
      hares = tail.slice(0, lastIdx).trim();
      location = tail.slice(lastIdx + lastLen).trim();
    } else {
      hares = tail;
    }
  }

  // "Hares Needed" sentinel — drop the value
  if (hares && /^Hares\s+Needed$/i.test(hares)) hares = undefined;

  return { runNumber, monthIdx, day, hares, location };
}

export interface ParseHarelineResult {
  events: RawEventData[];
  /** Run lines that matched the year-anchor tokenizer but failed the line parser. */
  skippedLines: number;
}

/**
 * Walk the rendered hareline text and emit events. Years act as parser
 * anchors — each `2026` / `2025` / etc. token resets the active year.
 */
/** Find all standalone 4-digit year headings (1900-2099) with their positions. */
function findYearHeadings(text: string): Array<{ year: number; start: number; end: number }> {
  const headings: Array<{ year: number; start: number; end: number }> = [];
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    const start = m.index ?? 0;
    headings.push({ year: Number.parseInt(m[1], 10), start, end: start + m[0].length });
  }
  return headings;
}

/** Find run-line start positions (`1016 – May`) within a year section. */
function findRunLineStarts(section: string): number[] {
  const starts: number[] = [];
  for (const m of section.matchAll(/\d{3,4}\s*[–—-]\s*[a-z]+/gi)) {
    if (m.index !== undefined) starts.push(m.index);
  }
  return starts;
}

export function parseHashHorrorsHareline(text: string): ParseHarelineResult {
  const events: RawEventData[] = [];
  let skippedLines = 0;
  const headings = findYearHeadings(text);

  for (let i = 0; i < headings.length; i++) {
    const { year, end } = headings[i];
    const sectionEnd = headings[i + 1]?.start ?? text.length;
    const section = text.slice(end, sectionEnd);
    const starts = findRunLineStarts(section);
    for (let j = 0; j < starts.length; j++) {
      const lineEnd = starts[j + 1] ?? section.length;
      const line = section.slice(starts[j], lineEnd).trim();
      const parsed = parseHashHorrorsRunLine(line);
      if (!parsed) {
        skippedLines++;
        continue;
      }
      const date = `${year}-${String(parsed.monthIdx).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
      events.push({
        date,
        startTime: DEFAULT_START_TIME,
        kennelTag: KENNEL_TAG,
        runNumber: parsed.runNumber,
        title: `Hash Horrors ${parsed.runNumber}`,
        hares: parsed.hares,
        location: parsed.location,
      });
    }
  }
  return { events, skippedLines };
}

export class HashHorrorsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const errorDetails: ErrorDetails = {};

    // Derive the WP.com site domain from source.url so the configured URL
    // is the single source of truth (matches the Seletar adapter pattern).
    let siteDomain = DEFAULT_SITE_DOMAIN;
    if (source.url) {
      try {
        siteDomain = new URL(source.url).hostname;
      } catch {
        // Fall back to the default if source.url is malformed.
      }
    }

    const result = await fetchWordPressComPage(siteDomain, HARELINE_SLUG);
    if (result.error || !result.page) {
      const message = result.error?.message ?? "WordPress.com API returned no page";
      errorDetails.fetch = [{ url: `https://${siteDomain}/${HARELINE_SLUG}/`, message, status: result.error?.status }];
      return { events: [], errors: [message], errorDetails };
    }

    const pageUrl = result.page.URL || `https://${siteDomain}/${HARELINE_SLUG}/`;
    // Collapse whitespace so the year/run-line tokenizer works on a flat string.
    const text = decodeEntities(stripHtmlTags(result.page.content)).replaceAll(/\s+/g, " ").trim();

    const { events: allEvents, skippedLines } = parseHashHorrorsHareline(text);
    // The hareline page is the ONLY feed for Hash Horrors and contains the
    // full archive back to Hash 1. Default to a 20-year window so the
    // recurring scrape ingests historical runs, not just the rolling year.
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365 * 20);
    const events = allEvents
      .map((e) => ({ ...e, sourceUrl: pageUrl }))
      .filter((e) => {
        const d = new Date(`${e.date}T12:00:00Z`);
        return d >= minDate && d <= maxDate;
      });

    const errors: string[] = [];

    // Surface dropped lines as scrape errors so the reconciler doesn't cancel
    // events on a partial parse (it only runs when errors.length === 0). A
    // single dropped line is enough to suppress reconciliation since the format
    // is fragile and silent drops would be indistinguishable from real removals.
    if (skippedLines > 0) {
      const message = `Hash Horrors hareline parser dropped ${skippedLines} line(s) — possible format drift`;
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    const structureHash = generateStructureHash(text);
    return {
      events,
      errors,
      structureHash,
      errorDetails: errors.length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        pageId: result.page.ID,
        pageModified: result.page.modified,
        runsParsed: allEvents.length,
        skippedLines,
        eventsInWindow: events.length,
        fetchDurationMs: result.fetchDurationMs,
      },
    };
  }
}
