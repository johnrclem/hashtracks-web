import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, parse12HourTime, fetchBrowserRenderedPage, stripZeroWidth } from "../utils";

// Re-exported from utils.ts (shared across Wix/Weebly adapters). Kept exported
// here for the existing northboro-hash.test.ts import.
export { stripZeroWidth };

/**
 * Parse a time mention from text like "12pm", "12:30pm", "11-12ish", "start time 11-12ish".
 * Returns HH:MM or undefined.
 */
export function parseTimeMention(text: string): string | undefined {
  // Try standard "12:30pm" format first
  const standard = parse12HourTime(text);
  if (standard) return standard;

  // Match bare hour with am/pm: "12pm", "11am"
  const bareMatch = /(\d{1,2})\s*(am|pm)/i.exec(text);
  if (bareMatch) {
    let hours = parseInt(bareMatch[1], 10);
    const ampm = bareMatch[2].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, "0")}:00`;
  }

  // Match range like "11-12ish" — take the later time as start
  const rangeMatch = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:ish)?/i.exec(text);
  if (rangeMatch) {
    const later = parseInt(rangeMatch[2], 10);
    // Assume PM for reasonable hash start times (10-18)
    const hours = later < 7 ? later + 12 : later;
    return `${hours.toString().padStart(2, "0")}:00`;
  }

  return undefined;
}

/**
 * parseTimeMention, but only when the text carries an explicit clock signal
 * (am/pm or HH:MM). Guards against a numeric range like "24-26" or "2-4 Mile"
 * being misread as a time by parseTimeMention's range branch.
 */
function strictTimeMention(text: string): string | undefined {
  return /\d{1,2}\s*[ap]m|\d{1,2}:\d{2}/i.test(text) ? parseTimeMention(text) : undefined;
}


/**
 * A standalone ANCIENT HASHTORY year heading: "2025", or the site's
 * OCR-style typo "2O18" (capital letter O standing in for zero). Returns the
 * numeric year (2000–2100) or undefined when the line isn't a year heading.
 */
export function matchSectionYear(line: string): number | undefined {
  const cleaned = stripZeroWidth(line).trim();
  if (!/^2[0O][0-9O]{2}$/.test(cleaned)) return undefined;
  const year = Number.parseInt(cleaned.replaceAll("O", "0"), 10);
  return year >= 2000 && year <= 2100 ? year : undefined;
}

/**
 * Parse a single trail text block into RawEventData.
 *
 * Expected patterns:
 * - "February Trail #237, 2/15/26"
 * - "January Trail #236, 1/1/26, Hangover Trail, Scrumples"
 * - "March Trail #238, 3/14/26, Pi Day Hash"
 * Hares on separate line: "Hares: Name1, Name2"
 * Location/time on separate lines: "Worcester, start time 11-12ish"
 *
 * `sectionYear` anchors year-less dates ("7/19") to the ANCIENT HASHTORY
 * section heading they appear under (#1757) — without it chrono resolves them
 * to the current scrape year. Explicit two-digit years ("2/15/26") always win.
 */
export function parseTrailBlock(
  lines: string[],
  sourceUrl: string,
  sectionYear?: number,
): RawEventData | null {
  if (lines.length === 0) return null;

  const firstLine = stripZeroWidth(lines[0]).trim();
  if (!firstLine) return null;

  // Match: "<Month> Trail #<num>, <date>" or "<Month> Trail #<num>: <date>"
  const trailMatch =
    /^(\w+)\s+Trail\s*#\s*(\d+)[,:]?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i.exec(
      firstLine,
    );
  if (!trailMatch) return null;

  const runNumber = parseInt(trailMatch[2], 10);
  const dateStr = trailMatch[3];

  // Build the date deterministically from M/D plus the year source (#1757).
  // A year-less "7/19" under the ANCIENT HASHTORY "2025" heading must resolve
  // to 2025, not chrono's relative guess (chrono anchored at Jan-1 pushes
  // later months into the prior year). Explicit two-/four-digit years win;
  // otherwise the section year, then the current year as a last resort.
  const md = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(dateStr);
  if (!md) return null;
  const month = Number.parseInt(md[1], 10);
  const day = Number.parseInt(md[2], 10);
  let year: number;
  if (md[3]) {
    year = Number.parseInt(md[3], 10);
    if (year < 100) year += 2000;
  } else {
    year = sectionYear ?? new Date().getUTCFullYear();
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through Date.UTC so an impossible source typo ("2/31") is
  // rejected instead of silently rolling over to a different day.
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  const date = parsed.toISOString().slice(0, 10);

  // Extract title — text after the date on the first line
  const afterDate = firstLine
    .slice(trailMatch.index + trailMatch[0].length)
    .replace(/^[,\s]+/, "")
    .trim();

  let title: string | undefined;
  let hares: string | undefined;
  let startTime: string | undefined;

  // Pull an explicit "Hare(s):" delimiter off first so commas inside the
  // title survive (#1758): "Hearts, Stars and Vampires, Hares: Scrumples,
  // Jesus Saves" → title "Hearts, Stars and Vampires", hares "Scrumples,
  // Jesus Saves". The trailing segment is the hare list verbatim.
  // Anchor the delimiter to start-or-comma so an incidental "Hare:" inside a
  // title ("Welcome to the Hare: Trap") doesn't split mid-title.
  const hareDelim = /(?:^|,)\s*Hares?:\s*/i.exec(afterDate);
  if (hareDelim) {
    hares = afterDate.slice(hareDelim.index + hareDelim[0].length).trim() || undefined;
    let titleText = afterDate.slice(0, hareDelim.index).trim();
    // Rare leading clock-time token before the title ("12:30pm, Theme, Hares:
    // …"). Require an am/pm or HH:MM signal so a numeric range like "2-4 Mile
    // Trail" isn't misread as a time.
    const leadComma = titleText.indexOf(",");
    const leadTime = leadComma > 0 ? strictTimeMention(titleText.slice(0, leadComma)) : undefined;
    if (leadTime) {
      startTime = leadTime;
      titleText = titleText.slice(leadComma + 1).trim();
    }
    title = titleText || undefined;
  } else {
    // No explicit delimiter — fall back to the comma-split heuristic.
    const parts = afterDate ? afterDate.split(",").map((s) => s.trim()) : [];
    title = parts[0] || undefined;

    // Detect field swap: if the "title" part is actually a time string
    // (e.g. "12:30pm"), the fields are shifted — promote the next part to title.
    const titleTime = title ? parseTimeMention(title) : undefined;
    if (titleTime) {
      startTime = titleTime;
      title = parts.length > 1 ? parts[1] : undefined;
      const hareParts = parts.slice(2);
      if (hareParts.length > 0) hares = hareParts.join(", ");
    } else if (parts.length > 1) {
      hares = parts.slice(1).join(", ");
    }

    // NbH3 convention: "Trail Name: Hare1 & Hare2" — split on first ": "
    if (title && title.includes(": ")) {
      const colonIdx = title.indexOf(": ");
      const afterColon = title.slice(colonIdx + 2).trim();
      title = title.slice(0, colonIdx).trim();
      hares = hares ? `${afterColon}, ${hares}` : afterColon;
    }
  }

  // Strip co-host event suffix: "& Partner Title (Partner Kennel H3)"
  if (title) {
    title = title.replace(/\s*&\s+.+?\s*\([^)]*(?:H3|HHH|Hash)\)\s*$/i, "").trim() || undefined;
  }

  let location: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for "Hares: Name1, Name2"
    const haresMatch = /^Hares?:\s*(.+)/i.exec(line);
    if (haresMatch) {
      hares = haresMatch[1].trim();
      continue;
    }

    // Check for time mentions
    const time = parseTimeMention(line);
    if (time) {
      startTime = time;
      // Extract location from same line (before "start time" or comma-separated)
      const locMatch = /^([^,]+?)(?:,\s*start\s+time|,\s*\d)/i.exec(line);
      if (locMatch && !/start\s+time/i.test(locMatch[1])) {
        location = locMatch[1].trim();
      }
      continue;
    }

    // If line doesn't match other patterns, treat as location —
    // but skip lines that duplicate the title or hare text (Wix rendering artifact)
    if (!location && !/trail|hash|#\d/i.test(line)) {
      const lineNorm = line.toLowerCase();
      const isDupeTitle = title && lineNorm.includes(title.toLowerCase().slice(0, 20));
      const isDupeHares = hares && lineNorm.includes(hares.toLowerCase().slice(0, 20));
      if (!isDupeTitle && !isDupeHares) {
        location = line;
      }
    }
  }

  return {
    date,
    kennelTags: ["nbh3"],
    runNumber,
    title: title || `NbH3 Trail #${runNumber}`,
    hares,
    location,
    startTime,
    sourceUrl,
  };
}

const MONTHS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);
const WEEKDAYS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
]);

/** Lowercased alpha-only first token of a line ("Fri," → "fri"). */
function firstToken(line: string): string {
  const first = line.trim().split(/\s+/, 1)[0] ?? "";
  return first.replace(/[^A-Za-z]/g, "").toLowerCase();
}

/** Boilerplate / label lines in the Upcumming section that are never event titles. */
const FREEFORM_BOILERPLATE_RE =
  /venmo|facebook|paypal|rego using|we hash|hashing isn|trails are typically|mismanagement:|^bring |^rules:|^who:|^why:|^what:|^when:|^pro tip|^special guest|^also check|^\*/i;

/** A trailing line is usable as a venue when it carries a street number + comma (e.g. "Empire Village 446 Main St Stubridge, MA"). */
function freeformLocation(line: string | undefined): string | undefined {
  if (!line) return undefined;
  const cleaned = stripZeroWidth(line).trim();
  if (FREEFORM_BOILERPLATE_RE.test(cleaned)) return undefined;
  return /\d/.test(cleaned) && cleaned.includes(",") ? cleaned : undefined;
}

/**
 * Parse the freeform "Upcumming Trails" blocks that lack a "Trail #N" anchor
 * (#1759) — campouts and drinking practices. Two shapes are recognized:
 *   A) month-leading with the title on the same line:
 *      "July 24-26 Zombie Buffett: He is Risen" → date July 24, title after the day(s)
 *   B) a weekday-leading date line with the title on the preceding line:
 *      "Dinner and a Shitshow (Round 2)" / "Fri, June 12th 5:30pm"
 * Events emit with `runNumber: null` (no run number for socials). Date ranges
 * collapse to the start date. Blocks with no resolvable date are skipped (and
 * counted in `skipped` so the omission surfaces in diagnostics, never silent).
 */
export function parseUpcummingFreeform( // NOSONAR S3776
  lines: string[],
  sourceUrl: string,
): { events: RawEventData[]; skipped: number } {
  const events: RawEventData[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const emit = (title: string, date: string, startTime: string | undefined, nextLine: string | undefined) => {
    const cleanTitle = title.trim();
    if (!cleanTitle || FREEFORM_BOILERPLATE_RE.test(cleanTitle)) return;
    const key = `${date}|${cleanTitle.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({
      date,
      kennelTags: ["nbh3"],
      runNumber: null,
      title: cleanTitle,
      startTime,
      location: freeformLocation(nextLine),
      sourceUrl,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = stripZeroWidth(lines[i]).trim();
    if (!line || /Trail\s*#/i.test(line)) continue;
    const token = firstToken(line);

    // Shape A: "<Month> <day>[-<day>] <title…>" (day may carry an ordinal:
    // "July 4th BBQ"). A month-leading line we can't turn into a dated event
    // is counted in `skipped`, never silently dropped.
    if (MONTHS.has(token)) {
      const m = /^\S+\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?\s+(\S.*)$/i.exec(line);
      const date = m ? chronoParseDate(`${line.split(/\s+/, 1)[0]} ${m[1]}`, "en-US") : null;
      if (m && date) emit(m[2], date, strictTimeMention(line), lines[i + 1]);
      else skipped++;
      continue;
    }

    // Shape B: weekday-leading date line, title on the previous line. Skip
    // boilerplate AND other date lines (month/weekday-leading) so an adjacent
    // date line is never surfaced as the title.
    if (WEEKDAYS.has(token)) {
      const date = chronoParseDate(line, "en-US");
      if (!date) { skipped++; continue; }
      let title: string | undefined;
      for (let k = i - 1; k >= 0; k--) {
        const prev = stripZeroWidth(lines[k]).trim();
        if (!prev || FREEFORM_BOILERPLATE_RE.test(prev)) continue;
        const prevToken = firstToken(prev);
        // Stop at an event boundary — another date line (the previous event's
        // anchor) or an address line — rather than reaching across it and
        // surfacing a different event's title or a venue as the title.
        if (MONTHS.has(prevToken) || WEEKDAYS.has(prevToken)) break;
        if (freeformLocation(prev) !== undefined) break;
        title = prev;
        break;
      }
      if (title) emit(title, date, strictTimeMention(line), lines[i + 1]);
      else skipped++;
    }
  }

  return { events, skipped };
}

/**
 * Northboro Hash House Harriers (NbH3) Wix Site Scraper
 *
 * Scrapes northboroh3.com/calendar via the NAS headless browser rendering service.
 * The site is built on Wix, which renders content via JavaScript — standard HTTP
 * fetch returns empty containers. browserRender() renders the page with Chromium
 * and returns the fully rendered HTML for Cheerio parsing.
 *
 * The /calendar page has two sections:
 * - "Upcumming Trails" — upcoming events (1-2 at a time)
 * - "ANCIENT HASHTORY" — past trails grouped by year
 */
export class NorthboroHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const calendarUrl = (source.url || "https://www.northboroh3.com") + "/calendar";

    const page = await fetchBrowserRenderedPage(calendarUrl, {
      waitFor: "body",
      timeout: 20000,
    });

    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Extract text content from Wix rich-text elements
    // Wix wraps content in divs with data-testid or specific comp-* IDs
    const textBlocks: string[] = [];

    // Get all text from the page body, split by structural breaks
    $("p, h1, h2, h3, h4, h5, h6, li, div[data-testid]").each(
      (_i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 3) {
          textBlocks.push(text);
        }
      },
    );

    // Join all text and split into logical blocks by trail pattern
    const allText = textBlocks.join("\n");
    const lines = allText.split("\n").map((l) => l.trim()).filter(Boolean);

    // Walk the page tracking which section we're in. "Trail #N" rows feed the
    // numbered-trail parser; the ANCIENT HASHTORY year headings anchor year-less
    // dates (#1757); the Upcumming section's freeform prose feeds the freeform
    // parser (#1759). Headers can be appended to a content line ("…to join.
    // Upcumming Trails"), so they're matched by substring, not anchored.
    let currentBlock: string[] = [];
    let currentBlockYear: number | undefined;
    let section: "upcumming" | "ancient" | "other" = "other";
    let sectionYear: number | undefined;
    let rowIndex = 0;
    const upcummingLines: string[] = [];

    function processBlock() {
      if (currentBlock.length === 0) return;
      try {
        const event = parseTrailBlock(currentBlock, calendarUrl, currentBlockYear);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing trail block at row ${rowIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: rowIndex,
            error: String(err),
            rawText: currentBlock.join("\n").slice(0, 2000),
          },
        ];
      }
      rowIndex++;
      currentBlock = [];
    }

    for (const raw of lines) {
      const line = stripZeroWidth(raw).trim();
      if (!line) continue;

      if (/ANCIENT HASHTORY/i.test(line)) {
        processBlock();
        section = "ancient";
        sectionYear = undefined;
        continue;
      }
      if (/Upcumming/i.test(line)) {
        processBlock();
        section = "upcumming";
        sectionYear = undefined;
        continue;
      }
      const yr = matchSectionYear(line);
      if (yr !== undefined) {
        processBlock();
        if (section === "ancient") sectionYear = yr;
        continue;
      }

      const isTrailLine =
        /^\w+\s+Trail\s*#\s*\d+[,:]?\s*\d{1,2}\/\d{1,2}/i.test(line);
      if (isTrailLine) {
        processBlock();
        currentBlock = [line];
        currentBlockYear = sectionYear;
      } else if (currentBlock.length > 0) {
        currentBlock.push(line);
      } else if (section === "upcumming") {
        upcummingLines.push(line);
      }
    }

    // Process last block
    processBlock();

    // Freeform Upcumming blocks (campouts, drinking practices) — no "Trail #N".
    const { events: freeformEvents, skipped: freeformSkipped } =
      parseUpcummingFreeform(upcummingLines, calendarUrl);
    events.push(...freeformEvents);

    // Deduplicate by run number (Wix nested elements can produce duplicate text).
    // Freeform events have null runNumber and are never deduped here.
    const seen = new Set<number>();
    const dedupedEvents: RawEventData[] = [];
    for (const event of events) {
      const rn = event.runNumber;
      if (typeof rn === "number") {
        if (seen.has(rn)) continue;
        seen.add(rn);
      }
      dedupedEvents.push(event);
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: dedupedEvents,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        textBlocksFound: textBlocks.length,
        eventsParsed: dedupedEvents.length,
        freeformEvents: freeformEvents.length,
        freeformSkipped,
        fetchDurationMs,
      },
    };
  }
}
