/**
 * The Hague Hash House Harriers (Hague H3) Website Adapter
 *
 * Scrapes haguehash.nl for hash events. The site uses WPBakery page builder
 * with each event in a separate `<section>` containing a `.wpb_text_column
 * .wpb_wrapper` div. Events are separated by "OnOn" markers.
 *
 * Event format (after br→newline conversion):
 *   Run 2412
 *   When: Sunday, March 29
 *   Time: 14:00 hr
 *   Where: Parallelweg crossing Houtrustweg by Sportcity, The Hague
 *   Hares: Balls on a Dyke
 *
 * Some events have:
 *   - Run number suffixes like "(50+% run)" or "(10.45 St Patrick's Day Run)"
 *   - Title text before "Run NNNN" (e.g., "Windmill Poker Run")
 *   - "Hare:" (singular) instead of "Hares:" (plural)
 *   - "Hare(s):" variant
 *   - Time with "." separator instead of ":" (e.g., "10.45 hr")
 *   - <strong> tags around non-standard times
 *   - "Link" text after location (Google Maps link)
 *   - Missing run numbers (special events with just a title)
 */

import * as cheerio from "cheerio";
import * as chrono from "chrono-node";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, buildDateWindow, decodeEntities } from "../utils";

// ── Constants ──

const KENNEL_TAG = "hagueh3";
const DEFAULT_START_TIME = "14:00";

// ── Regex patterns ──

/** Match run number: "Run 2412" or "Run 2410 (50+% run)" */
const RUN_NUMBER_RE = /Run\s+(\d{4})/;

/** Match date line: "When: Sunday, March 29" or "When: Sunday Februari 22th" */
const WHEN_RE = /When:\s*(.+)/i;

/** Match time: "Time: 14:00 hr" or "Time: 10.45 hr (Different From Normal)" */
const TIME_RE = /Time:\s*(?:<[^>]+>\s*)*(\d{1,2})[.:]\s*(\d{2})\s*hr/i;

/** Match location: "Where: ..." — first line only */
const WHERE_RE = /Where:\s*(.+)/i;

/** Match hares: "Hares: ...", "Hare: ...", or "Hare(s): ..." */
const HARES_RE = /Hare(?:s|\(s\))?:\s*(.+)/i;

// ── Exported helpers (for unit testing) ──

/**
 * Extract text blocks from the WPBakery page structure.
 * Each `.wpb_text_column .wpb_wrapper` in the main content area is one block.
 */
export function extractTextBlocks($: cheerio.CheerioAPI): string[] {
  const blocks: string[] = [];

  // WPBakery sections contain the event data
  $("section.l-section .wpb_text_column .wpb_wrapper").each(function () {
    const wrapper = $(this);
    // Replace <br> with newlines for line-based parsing
    wrapper.find("br").replaceWith("\n");
    const text = decodeEntities(wrapper.text()).trim();
    if (text.length > 10) {
      blocks.push(text);
    }
  });

  return blocks;
}

/**
 * Parse a single text block into RawEventData.
 * Returns null if the block doesn't contain a valid date.
 */
export function parseEventBlock(
  text: string,
  sourceUrl: string,
): RawEventData | null {
  // Extract date — required for all events
  const whenMatch = WHEN_RE.exec(text);
  if (!whenMatch) return null;

  const rawDateStr = whenMatch[1].trim();
  // Use chrono with en-GB for European date parsing, forwardDate=false since we want exact dates
  const parsed = chrono.en.parse(rawDateStr);
  if (parsed.length === 0) return null;

  const result = parsed[0].start;
  const year = result.get("year");
  const month = result.get("month");
  const day = result.get("day");
  if (year == null || month == null || day == null) return null;

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Extract run number (optional — some special events don't have one)
  let runNumber: number | undefined;
  const runMatch = RUN_NUMBER_RE.exec(text);
  if (runMatch) {
    runNumber = parseInt(runMatch[1], 10);
  }

  // Extract time
  let startTime = DEFAULT_START_TIME;
  const timeMatch = TIME_RE.exec(text);
  if (timeMatch) {
    startTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  }

  // Extract location — strip trailing "Link" text from Google Maps links
  let location: string | undefined;
  const whereMatch = WHERE_RE.exec(text);
  if (whereMatch) {
    location = whereMatch[1]
      .trim()
      .replace(/\s*Link\s*$/i, "")
      .replace(/\s*https?:\/\/\S+/g, "")
      .trim();
    if (!location) location = undefined;
  }

  // Extract hares
  let hares: string | undefined;
  const haresMatch = HARES_RE.exec(text);
  if (haresMatch) {
    hares = haresMatch[1].trim();
    // Truncate at "Cost:" or "Inquiries?" that may follow on the same line
    hares = hares
      .replace(/\s*Cost:.*$/i, "")
      .replace(/\s*Inquiries\?.*$/i, "")
      .trim();
    if (!hares) hares = undefined;
  }

  // Extract title: look for text before "Run NNNN" that isn't just whitespace
  let title: string | undefined;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (RUN_NUMBER_RE.test(line) || /^When:/i.test(line)) break;
    // Use the first substantive line as the title
    if (line.length > 2 && !/^OnOn/i.test(line)) {
      title = line;
      break;
    }
  }

  // Build event title
  let eventTitle: string;
  if (title && runNumber) {
    eventTitle = `Hague H3 #${runNumber} — ${title}`;
  } else if (title) {
    eventTitle = `Hague H3 — ${title}`;
  } else if (runNumber) {
    eventTitle = `Hague H3 #${runNumber}`;
  } else {
    return null; // No run number and no title — skip
  }

  return {
    date,
    kennelTags: [KENNEL_TAG],
    title: eventTitle,
    runNumber,
    hares,
    location,
    startTime,
    sourceUrl,
  };
}

/**
 * Extract all events from the page's text blocks.
 */
export function extractEvents(
  blocks: string[],
  sourceUrl: string,
): { events: RawEventData[]; errors: ParseError[] } {
  const events: RawEventData[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Skip blocks that don't look like event data
    if (!WHEN_RE.test(block)) continue;

    try {
      const event = parseEventBlock(block, sourceUrl);
      if (event) events.push(event);
    } catch (err) {
      errors.push({
        row: i,
        error: String(err),
        rawText: block.slice(0, 2000),
      });
    }
  }

  return { events, errors };
}

// ── Adapter class ──

export class HagueH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://haguehash.nl/";
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // ── Fetch page ──
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;

    // ── Extract text blocks from WPBakery sections ──
    const blocks = extractTextBlocks(page.$);

    // ── Parse events ──
    const { events, errors: parseErrors } = extractEvents(blocks, sourceUrl);

    if (parseErrors.length > 0) {
      (errorDetails.parse ??= []).push(...parseErrors);
    }

    // ── Filter by date window ──
    const { minDate, maxDate } = buildDateWindow(source.scrapeDays ?? 365);
    const filtered = events.filter((ev) => {
      const d = new Date(ev.date + "T12:00:00Z");
      return d >= minDate && d <= maxDate;
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: filtered,
      errors: allErrors,
      structureHash: page.structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        totalBlocks: blocks.length,
        totalEvents: events.length,
        totalAfterFilter: filtered.length,
        fetchDurationMs: page.fetchDurationMs,
      },
    };
  }
}
