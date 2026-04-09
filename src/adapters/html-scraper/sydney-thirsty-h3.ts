import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  fetchHTMLPage,
  parse12HourTime,
  stripPlaceholder,
} from "../utils";

/**
 * Sydney Thirsty H3 — sth3.org
 *
 * The "Upcoming Runs" page is published on a Google Sites-style template
 * (`p.zfr3Q` paragraphs inside `[role="main"]`). Despite the JS-heavy
 * shell the run content is server-rendered into the initial HTML, so
 * plain Cheerio works (Chrome verified — `outerHTML.includes('Run #1842')`).
 *
 * Layout: a sequence of `<p>` blocks separated by an em-dash `<p>` whose
 * trimmed text is exactly "—". Within each block:
 *
 *   <p>Thursday April 9th at 6:30pm</p>     ← date + time freeform
 *   <p>Run #1842</p>                        ← required anchor
 *   <p>Location: Redfern Park, Redfern</p>  ← optional
 *   <p>Map: <a href="…">here</a></p>        ← optional Google Maps
 *
 * Special-event quirks (Chrome verified):
 *  - The AGPU weekend block has no Run # line and instead reads
 *    "Runs (Sat and Sun) 1843 & 1844" (multi-day, no Location).
 *  - The Beer Mile block carries an extra description `<p>` between the
 *    Run line and the Location line.
 *
 * Parser strategy: take the first `<p>` of each block as the date line,
 * locate the first `Run #` line, and harvest optional Location/Map
 * fields anywhere else in the block. Blocks lacking a parseable date or
 * run number are skipped (multi-day specials silently dropped — fine
 * for Phase 1b).
 */

const KENNEL_TAG = "sth3-au";
const SOURCE_URL_DEFAULT = "https://www.sth3.org/upcoming-runs";

const EM_DASH_RE = /^[—–-]$/;

interface ThirstyParagraph {
  text: string;
  href?: string;
}

/**
 * Split a flat sequence of paragraphs into per-run blocks. Each block
 * starts after the previous em-dash divider and ends before the next.
 *
 * Exported for unit testing.
 */
export function splitThirstyBlocks(paragraphs: ThirstyParagraph[]): ThirstyParagraph[][] {
  const blocks: ThirstyParagraph[][] = [];
  let current: ThirstyParagraph[] = [];
  for (const p of paragraphs) {
    const t = p.text.trim();
    if (!t) continue;
    if (EM_DASH_RE.test(t)) {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Parse a single Sydney Thirsty block into a RawEventData. Returns null
 * when the block is missing the required date or run number lines (e.g.
 * the multi-day AGPU special-event block).
 *
 * Exported for unit testing.
 */
export function parseThirstyBlock(
  block: ThirstyParagraph[],
  sourceUrl: string,
  referenceDate: Date = new Date(),
): RawEventData[] {
  // Find the run-number anchor first, then walk every other paragraph to
  // collect the date line (chrono-parseable), the Location, and the Map
  // link. Using chrono as the filter for "is this a date line?" lets the
  // parser ignore header paragraphs like "Upcoming Runs" or the "First
  // time? …" intro that share a block with the first real run.
  //
  // Returns an array so multi-day special-event blocks (AGPU weekend
  // format "Runs (Sat and Sun) 1843 & 1844") can emit one event per
  // run number. Single-run blocks return a length-1 array; unparseable
  // blocks return [].
  let dateLine: string | undefined;
  let date: string | undefined;
  const runNumbers: number[] = [];
  let location: string | undefined;
  let locationUrl: string | undefined;
  let startTime: string | undefined;

  for (const p of block) {
    const t = p.text.trim();

    // Standard "Run #1842" format.
    const runMatch = /^Run\s*#\s*(\d+)/i.exec(t);
    if (runMatch && runNumbers.length === 0) {
      runNumbers.push(Number.parseInt(runMatch[1], 10));
      continue;
    }

    // Multi-run special-event format: "Runs (Sat and Sun) 1843 & 1844"
    // or "Runs 1843 & 1844". Emit one event per run number in the line.
    const multiRunMatch = /^Runs?\b[^0-9]*(\d+)(?:\s*(?:&|and)\s*(\d+))?/i.exec(t);
    if (multiRunMatch && runNumbers.length === 0) {
      runNumbers.push(Number.parseInt(multiRunMatch[1], 10));
      if (multiRunMatch[2]) runNumbers.push(Number.parseInt(multiRunMatch[2], 10));
      continue;
    }

    const locMatch = /^Location:\s*(.+)$/i.exec(t);
    if (locMatch && !location) {
      location = stripPlaceholder(locMatch[1]);
      continue;
    }
    if (/^Map:/i.test(t) && p.href && !locationUrl) {
      locationUrl = p.href;
      continue;
    }
    if (!date) {
      // Try to parse this as a date line. If chrono succeeds, capture
      // both the resolved date and the raw text (for start-time
      // extraction below).
      const candidate = chronoParseDate(t, "en-GB", referenceDate, { forwardDate: true });
      if (candidate) {
        date = candidate;
        dateLine = t;
      }
    }
  }

  if (!date || runNumbers.length === 0) return [];

  // Extract a HH:MM time from the date line if it has one (e.g. "at 6:30pm").
  if (dateLine) {
    const tMatch = parse12HourTime(dateLine);
    if (tMatch) startTime = tMatch;
  }

  return runNumbers.map((runNumber) => ({
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    location,
    locationUrl,
    startTime,
    sourceUrl,
  }));
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

    const paragraphs: ThirstyParagraph[] = [];
    page.$("[role='main'] p.zfr3Q").each((_i, el) => {
      const $p = page.$(el);
      const text = $p.text();
      const href = $p.find("a[href]").attr("href");
      paragraphs.push({ text, href });
    });

    const blocks = splitThirstyBlocks(paragraphs);
    const events: RawEventData[] = [];
    for (const block of blocks) {
      events.push(...parseThirstyBlock(block, url));
    }

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
          paragraphsFound: paragraphs.length,
          blocksFound: blocks.length,
          eventsParsed: events.length,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
