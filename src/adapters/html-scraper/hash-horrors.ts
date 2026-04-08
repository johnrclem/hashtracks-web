import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { fetchWordPressComPage } from "../wordpress-api";
import { MONTHS, decodeEntities, buildDateWindow, stripHtmlTags } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";

const SITE_DOMAIN = "hashhousehorrors.com";
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
    const lastDash = Math.max(
      tail.lastIndexOf(" – "),
      tail.lastIndexOf(" — "),
      tail.lastIndexOf(" - "),
    );
    if (lastDash > 0) {
      hares = tail.slice(0, lastDash).trim();
      location = tail.slice(lastDash + 3).trim();
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
export function parseHashHorrorsHareline(text: string): ParseHarelineResult {
  const events: RawEventData[] = [];
  let skippedLines = 0;
  // Tokenize: each match is either a 4-digit year heading (group 1) OR a
  // run line (group 2). The lookahead stops the run capture at the next
  // run number or year boundary so multi-family hare lists with internal
  // dashes survive.
  const tokens = text.matchAll(
    /((?:19|20)\d{2})\s+|(\d{3,4}\s*[–—-]\s*[a-z]+\s+\d{1,2}(?:\s*[–—-]\s*[^]+?)?)(?=\s+\d{3,4}\s*[–—-]|\s+(?:19|20)\d{2}\s|$)/gi,
  );

  let activeYear: number | undefined;
  for (const tok of tokens) {
    const yearStr = tok[1];
    const runStr = tok[2];
    if (yearStr) {
      activeYear = Number.parseInt(yearStr, 10);
      continue;
    }
    if (!runStr || !activeYear) continue;
    const parsed = parseHashHorrorsRunLine(runStr.trim());
    if (!parsed) {
      skippedLines++;
      continue;
    }
    const date = `${activeYear}-${String(parsed.monthIdx).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
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
  return { events, skippedLines };
}

export class HashHorrorsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    _source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const errorDetails: ErrorDetails = {};

    const result = await fetchWordPressComPage(SITE_DOMAIN, HARELINE_SLUG);
    if (result.error || !result.page) {
      const message = result.error?.message ?? "WordPress.com API returned no page";
      errorDetails.fetch = [{ url: `https://${SITE_DOMAIN}/${HARELINE_SLUG}/`, message, status: result.error?.status }];
      return { events: [], errors: [message], errorDetails };
    }

    const pageUrl = result.page.URL || `https://${SITE_DOMAIN}/${HARELINE_SLUG}/`;
    // Collapse whitespace so the year/run-line tokenizer works on a flat string.
    const text = decodeEntities(stripHtmlTags(result.page.content)).replaceAll(/\s+/g, " ").trim();

    const { events: allEvents, skippedLines } = parseHashHorrorsHareline(text);
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);
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
