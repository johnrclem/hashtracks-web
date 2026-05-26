/**
 * Montreal H3 (MH3) Scraper — mhhh.ca
 *
 * Closes coverage gap from #1660: the kennel's Meetup source frequently shows
 * "Location not specified yet" while mhhh.ca's homepage publishes the
 * neighborhood + hares per upcoming run.
 *
 * The homepage hareline is a static HTML table grouped by month. Each run is
 * a four-`<tr>` block keyed off label text in column 2:
 *
 *   tr1: "RUN #NNNN"
 *   tr2: "Date/Cost:" → "May 3, 2026&nbsp;13h00 $13"
 *   tr3: "Hare(s):"   → "Broken Thong"
 *   tr4: "Location:"  → "Sainte-Marie <a href="meetup_url">Click for directions</a>"
 *
 * Month-header rows in between carry the year context (e.g. "May 2026"). The
 * parser tracks the current month/year header and combines with the day from
 * "Date/Cost:" to build a UTC-noon-normalized date.
 *
 * Parser keys on text-content shape (label prefixes "RUN #", "Date/Cost:",
 * "Hare(s):", "Location:") rather than CSS classes — the page is FrontPage-
 * generated and any future redesign would change classes long before it
 * changed those labels.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import {
  fetchHTMLPage,
  buildDateWindow,
  decodeEntities,
  extractHashRunNumber,
  MONTHS,
} from "../utils";

interface MhhhCaConfig {
  /** Defaults to "mh3-ca". */
  kennelTag?: string;
}

const KENNEL_TAG_DEFAULT = "mh3-ca";

/**
 * Recognize the "Month YYYY" header rows that separate run blocks. The
 * `[A-Za-z]+` capture is intentionally broad — non-month names like
 * "Spring 2026" are rejected downstream by the `MONTHS` Set lookup. Don't
 * "tighten" the regex to a literal month alternation; the broad-capture +
 * Set-validation form is the lower-complexity option (Sonar S5843).
 */
const MONTH_HEADER_RE = /^([A-Za-z]+)\s+(\d{4})$/;

/** "May 3, 2026 13h00 $13" → { day: 3, time: "13:00", cost: "$13" } */
export function parseDateCost(
  text: string,
): { day: number; month?: number; year?: number; time?: string; cost?: string } | null {
  const cleaned = decodeEntities(text).replace(/\s+/g, " ").trim();
  const dateMatch = /\b([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(cleaned);
  if (!dateMatch) return null;
  const month = MONTHS[dateMatch[1].toLowerCase()];
  if (month === undefined) return null;
  const day = Number.parseInt(dateMatch[2], 10);
  if (day < 1 || day > 31) return null;
  const year = dateMatch[3] ? Number.parseInt(dateMatch[3], 10) : undefined;

  // Kennel uses 24h "HHhMM" verbatim; no AM/PM variants observed. Bound-check
  // hour/minute so a malformed cell like "25h99" doesn't poison startTime.
  const timeMatch = /\b(\d{1,2})h(\d{2})\b/.exec(cleaned);
  let time: string | undefined;
  if (timeMatch) {
    const hh = Number.parseInt(timeMatch[1], 10);
    const mm = Number.parseInt(timeMatch[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      time = `${String(hh).padStart(2, "0")}:${timeMatch[2]}`;
    }
  }

  const cost = /\$\d+(?:\.\d{2})?/.exec(cleaned)?.[0];

  return { day, month, year, time, cost };
}

interface ParsedRun {
  runNumber?: number;
  day: number;
  month: number;
  year: number;
  startTime?: string;
  cost?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;
}

/** "Show May 2026 Hide" / "May 2026" → { month: 5, year: 2026 } or null. */
function parseMonthHeader(rawText: string): { month: number; year: number } | null {
  // Strip optional Show/Hide toggle wrapper procedurally (Sonar S5852 dodge).
  let text = rawText;
  if (text.startsWith("Show ")) text = text.slice(5).trimStart();
  if (text.endsWith(" Hide")) text = text.slice(0, -5).trimEnd();
  const match = MONTH_HEADER_RE.exec(text);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  return { month, year: Number.parseInt(match[2], 10) };
}

/** Pull label + value cells from a row (always columns 2 and 3 of the table). */
function extractRowCells(
  $: cheerio.CheerioAPI,
  $tr: cheerio.Cheerio<AnyNode>,
): { labelText: string; valueText: string; valueCell: cheerio.Cheerio<AnyNode> | null } | null {
  const tds = $tr.find("td");
  if (tds.length < 2) return null;
  const labelText = decodeEntities($(tds[1]).text()).replace(/\s+/g, " ").trim();
  const valueCell = tds.length >= 3 ? $(tds[2]) : null;
  const valueText = valueCell
    ? decodeEntities(valueCell.text()).replace(/\s+/g, " ").trim()
    : "";
  return { labelText, valueText, valueCell };
}

/** Extract the neighborhood text from a "Location:" cell, stripping the directions link. */
function extractLocation(
  valueText: string,
  valueCell: cheerio.Cheerio<AnyNode> | null,
): { neighborhood: string | undefined; href: string | undefined } {
  const link = valueCell?.find("a").first();
  const linkText = link ? decodeEntities(link.text()).trim() : "";
  const neighborhood = (linkText
    ? valueText.replace(linkText, "")
    : valueText.replace(/\bClick for directions\b.*$/i, "")
  ).trim();
  return { neighborhood: neighborhood || undefined, href: link?.attr("href") };
}

/** Push the in-progress block into `runs` if every required field is set. */
function finalizeRun(current: Partial<ParsedRun>, runs: ParsedRun[]): void {
  if (
    current.runNumber !== undefined &&
    current.day !== undefined &&
    current.month !== undefined &&
    current.year !== undefined
  ) {
    runs.push(current as ParsedRun);
  }
}

/** Apply a parsed Date/Cost value to the in-progress block. */
function applyDateCost(
  current: Partial<ParsedRun>,
  valueText: string,
  activeMonth: number | undefined,
  activeYear: number | undefined,
): void {
  const dc = parseDateCost(valueText);
  if (!dc) return;
  const month = dc.month ?? activeMonth;
  const year = dc.year ?? activeYear;
  if (month === undefined || year === undefined) return;
  current.day = dc.day;
  current.month = month;
  current.year = year;
  current.startTime = dc.time;
  current.cost = dc.cost;
}

/**
 * Extract event blocks from the homepage HTML.
 *
 * The homepage table interleaves month-header rows (`<b>&nbsp;May 2026&nbsp;</b>`)
 * with 4-row run blocks. We walk every `<tr>` in document order, updating the
 * "active month/year" when we hit a header, then assembling the run block
 * when we see a "RUN #" cell followed by Date/Hares/Location labels.
 */
export function parseMhhhHomepage(html: string): ParsedRun[] {
  const $ = cheerio.load(html);
  const runs: ParsedRun[] = [];

  let activeMonth: number | undefined;
  let activeYear: number | undefined;
  let current: Partial<ParsedRun> | null = null;

  $("tr").each((_, tr) => {
    const $tr = $(tr);
    const rawText = decodeEntities($tr.text()).replace(/\s+/g, " ").trim();
    if (!rawText) return;

    const monthHeader = parseMonthHeader(rawText);
    if (monthHeader) {
      activeMonth = monthHeader.month;
      activeYear = monthHeader.year;
      return;
    }

    const cells = extractRowCells($, $tr);
    if (!cells) return;
    const { labelText, valueText, valueCell } = cells;

    const runNumberFromLabel = extractHashRunNumber(labelText);
    if (runNumberFromLabel !== undefined) {
      current = { runNumber: runNumberFromLabel };
      return;
    }
    if (!current) return;

    if (/^Date\/Cost:/i.test(labelText)) {
      applyDateCost(current, valueText, activeMonth, activeYear);
    } else if (/^Hare\(s\):/i.test(labelText)) {
      current.hares = valueText || undefined;
    } else if (/^Location:/i.test(labelText)) {
      const { neighborhood, href } = extractLocation(valueText, valueCell);
      current.location = neighborhood;
      if (href) current.locationUrl = href;
      // Location row terminates a run block in MH3's table.
      finalizeRun(current, runs);
      current = null;
    }
  });

  return runs;
}

/** Map a ParsedRun to the RawEventData shape consumed by the merge pipeline. */
function buildRawEvent(run: ParsedRun, kennelTag: string, sourceUrl: string): RawEventData {
  const m = String(run.month).padStart(2, "0");
  const d = String(run.day).padStart(2, "0");
  // Resolve relative hrefs (defensive — observed hrefs today are absolute Meetup
  // URLs, but FrontPage-era markup occasionally emits relative paths).
  let locationUrl = run.locationUrl;
  if (locationUrl) {
    try {
      locationUrl = new URL(locationUrl, sourceUrl).href;
    } catch {
      /* keep original if URL parsing throws */
    }
  }
  return {
    date: `${run.year}-${m}-${d}`,
    kennelTags: [kennelTag],
    runNumber: run.runNumber,
    hares: run.hares,
    location: run.location,
    locationUrl,
    startTime: run.startTime,
    cost: run.cost,
    sourceUrl,
  };
}

export class MhhhCaAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const cfg: MhhhCaConfig =
      source.config && typeof source.config === "object" && !Array.isArray(source.config)
        ? (source.config as MhhhCaConfig)
        : {};
    const kennelTag = cfg.kennelTag || KENNEL_TAG_DEFAULT;
    const url = source.url || "https://mhhh.ca/";

    const { minDate, maxDate } = buildDateWindow(options?.days);

    const page = await fetchHTMLPage(url);
    if (!page.ok) {
      const errorDetails: ErrorDetails = {};
      if (page.result.errorDetails?.fetch) {
        errorDetails.fetch = page.result.errorDetails.fetch;
      }
      return {
        events: [],
        errors: [...page.result.errors],
        errorDetails,
        structureHash: page.result.structureHash,
      };
    }

    let runs: ParsedRun[];
    try {
      runs = parseMhhhHomepage(page.html);
    } catch (err) {
      const msg = `Failed to parse mhhh.ca homepage: ${err instanceof Error ? err.message : String(err)}`;
      return {
        events: [],
        errors: [msg],
        errorDetails: { parse: [{ row: 0, error: msg }] },
        structureHash: page.structureHash,
      };
    }

    const events: RawEventData[] = [];
    for (const run of runs) {
      const ev = buildRawEvent(run, kennelTag, url);
      const eventDate = new Date(`${ev.date}T12:00:00Z`);
      if (eventDate < minDate || eventDate > maxDate) continue;
      events.push(ev);
    }

    return {
      events,
      errors: [],
      structureHash: page.structureHash,
      diagnosticContext: {
        runsParsed: runs.length,
        eventsAfterWindow: events.length,
        fetchDurationMs: page.fetchDurationMs,
      },
    };
  }
}
