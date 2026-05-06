import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchBrowserRenderedPage, HARE_BOILERPLATE_RE } from "../utils";

/**
 * Parse a Google Calendar "render" link into RawEventData.
 *
 * The Wix hareline page embeds "Add to Google Calendar" links with structured
 * event data in query params:
 *   text    = "BTVH3 #846: Season Premier"
 *   dates   = "20260401T223000Z/20260401T233000Z"
 *   details = HTML with hares, cost, length
 *   location = venue string
 */
export function parseCalendarLink(
  href: string,
  sourceUrl: string,
): RawEventData | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const text = url.searchParams.get("text") ?? "";
  const dates = url.searchParams.get("dates") ?? "";
  const details = url.searchParams.get("details") ?? "";
  const location = url.searchParams.get("location") ?? "";

  if (!text || !dates) return null;

  // Parse dates: "20260401T223000Z/20260401T233000Z"
  const dateParts = dates.split("/");
  if (dateParts.length < 1) return null;

  const startUtc = dateParts[0];
  // Parse UTC timestamp: 20260401T223000Z → 2026-04-01 + local time
  const dateMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(startUtc);
  if (!dateMatch) return null;

  const utcDate = new Date(
    Date.UTC(
      Number.parseInt(dateMatch[1]),
      Number.parseInt(dateMatch[2]) - 1,
      Number.parseInt(dateMatch[3]),
      Number.parseInt(dateMatch[4]),
      Number.parseInt(dateMatch[5]),
      Number.parseInt(dateMatch[6]),
    ),
  );

  // Convert to America/New_York local time
  const localStr = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
  const localDate = new Date(localStr);

  const yyyy = localDate.getFullYear();
  const mm = String(localDate.getMonth() + 1).padStart(2, "0");
  const dd = String(localDate.getDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;

  const hh = String(localDate.getHours()).padStart(2, "0");
  const min = String(localDate.getMinutes()).padStart(2, "0");
  const startTime = `${hh}:${min}`;

  const { title, runNumber } = parseTitleAndRunNumber(text.trim());

  // Parse details — strip HTML, then extract labeled fields and free-form prose.
  // The live Wix payload uses `<br>` between labeled fields and before the
  // free-form prose; convert those to `\n` purely so cheerio.text() preserves
  // visual breaks. Field extraction relies on known label markers (not `\n`)
  // as terminators, so an internal break inside a value doesn't truncate it.
  const detailsWithBreaks = details.replace(/<br\s*\/?>/gi, "\n");
  const detailText = cheerio.load(detailsWithBreaks).text().trim();

  // Hares: slice from after "Hares:" to the next known field marker,
  // paragraph break, or EOF. #825 inlines "Length:"/"Shiggy Scale:" with no
  // whitespace so they're terminators alongside Location:/Cost:/HASH CASH/
  // On-On. Using indexOf-based slicing (not a single regex with alternation
  // in a lookahead) avoids catastrophic backtracking on long payloads.
  const hares = extractHares(detailText);

  // #887: extract cost (always formatted as "$X.XX" — Burly is USD-only).
  let cost: string | undefined;
  const costMatch = /Cost:\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i.exec(detailText);
  if (costMatch) cost = `$${costMatch[1]}`;

  // #890: extract Length + Shiggy Scale. Both labels already terminate
  // hares (HARES_TERMINATORS_RE), so the values land between the label and
  // the next labeled field — same indexOf-based slicing pattern.
  //
  // Atomic-bundle semantics for the trail-length triple:
  //   • Label NOT found → all three stay `undefined`. Merge preserves
  //     existing values (consistent with description/haresText handling).
  //   • Label found but numerics unparseable (e.g. "TBD") → text is
  //     populated; numerics emit explicit `null`. Merge writes nulls,
  //     clearing any stale parsed range from a prior scrape. Without this,
  //     `Length: 3-5 Miles → Length: TBD` would leave `min=3, max=5`
  //     wired to fresh text="TBD" — a silent corruption (Codex finding).
  const lengthRaw = extractLabeledField(detailText, LENGTH_LABEL_RE);
  const parsedLength = parseTrailLength(lengthRaw);
  const trailLengthText =
    lengthRaw === undefined ? undefined : parsedLength.trailLengthText ?? null;
  const trailLengthMinMiles =
    lengthRaw === undefined ? undefined : parsedLength.trailLengthMinMiles ?? null;
  const trailLengthMaxMiles =
    lengthRaw === undefined ? undefined : parsedLength.trailLengthMaxMiles ?? null;

  // Same atomic semantic for difficulty: label-present-but-out-of-range
  // emits `null` so the canonical event doesn't keep a stale Shiggy
  // rating after the source drops the value.
  const shiggyRaw = extractLabeledField(detailText, SHIGGY_LABEL_RE);
  const difficulty =
    shiggyRaw === undefined ? undefined : parseShiggyScale(shiggyRaw) ?? null;

  // #887: extract free-form description. Wix puts `<br><br>` (a blank line
  // after `<br>→\n` conversion) before the prose paragraph that follows the
  // labeled fields. Anchoring on that paragraph break avoids treating any
  // single-break continuation of a labeled value as the start of description.
  // Newlines are preserved so the UI can render paragraph structure.
  let description: string | undefined;
  const paragraphBreak = detailText.search(/\n[\t ]*\n/);
  if (paragraphBreak >= 0) {
    const descText = detailText.slice(paragraphBreak).replace(/^\s+/, "").trim();
    if (descText.length >= 10) description = descText;
  }

  return {
    date,
    kennelTags: ["burlyh3"],
    runNumber,
    title,
    hares,
    cost,
    description,
    location: location.trim() || undefined,
    startTime,
    sourceUrl,
    trailLengthText,
    trailLengthMinMiles,
    trailLengthMaxMiles,
    difficulty,
  };
}

const HARES_LABEL_RE = /Hares?:\s*/i;
const HARES_TERMINATORS_RE = /Length\s*:|Shiggy\s*Scale\s*:|Location\s*:|Cost\s*:|HASH\s*CASH|On[\s-]*On|\n[\t ]*\n/i;

function extractHares(detailText: string): string | undefined {
  const labelMatch = HARES_LABEL_RE.exec(detailText);
  if (!labelMatch) return undefined;
  const rest = detailText.slice(labelMatch.index + labelMatch[0].length);
  const termMatch = HARES_TERMINATORS_RE.exec(rest);
  const value = termMatch ? rest.slice(0, termMatch.index) : rest;
  const cleaned = value.replace(HARE_BOILERPLATE_RE, "").trim();
  return cleaned || undefined;
}

// #890: terminators for trail-length / shiggy-scale values. Matches
// HARES_TERMINATORS_RE in spirit — handles BurlyH3's #850 payload where
// labels run together with no whitespace ("...Length: TBDShiggy Scale:
// 4Cost:..."), so a labeled value ends at the next label even without
// a delimiter. Colon-suffixed labels share one alternation group to keep
// regex complexity under SonarCloud's S5843 threshold.
const FIELD_TERMINATORS_RE = /(?:Length|Shiggy\s*Scale|Hares?|Location|Cost)\s*:|HASH\s*CASH|On[\s-]*On|\n[\t ]*\n/i;
const LENGTH_LABEL_RE = /Length\s*:\s*/i;
const SHIGGY_LABEL_RE = /Shiggy\s*Scale\s*:\s*/i;

/**
 * Parse the calendar-link `text` field into title + run number.
 *
 * Three accepted forms (#889):
 *   "BTVH3 #846: Season Premier"       → title "Season Premier"
 *   "BTVH3 #851 ft. Not Just the Tip"  → title "ft. Not Just the Tip" (prefix kept)
 *   "BTVH3 #852"                        → title "BurlyH3 #852"
 */
function parseTitleAndRunNumber(raw: string): { title: string; runNumber: number | undefined } {
  const colonMatch = /(?:BTVH3|BurlyH3|Burlington)\s*#(\d+)\s*[:\-–]\s*(.*)/i.exec(raw);
  if (colonMatch) {
    const runNumber = Number.parseInt(colonMatch[1], 10);
    return { title: colonMatch[2].trim() || `BurlyH3 #${runNumber}`, runNumber };
  }
  const altMatch = /(?:BTVH3|BurlyH3|Burlington)\s*#(\d+)(?:\s+(ft\.|feat\.)\s+(.+)|\s*$)/i.exec(raw);
  if (altMatch) {
    const runNumber = Number.parseInt(altMatch[1], 10);
    const featSep = altMatch[2];
    const rest = altMatch[3];
    return { title: featSep ? `${featSep} ${rest}`.trim() : `BurlyH3 #${runNumber}`, runNumber };
  }
  return { title: raw, runNumber: undefined };
}

function extractLabeledField(detailText: string, labelRe: RegExp): string | undefined {
  const labelMatch = labelRe.exec(detailText);
  if (!labelMatch) return undefined;
  const rest = detailText.slice(labelMatch.index + labelMatch[0].length);
  const termMatch = FIELD_TERMINATORS_RE.exec(rest);
  const value = (termMatch ? rest.slice(0, termMatch.index) : rest).trim();
  return value || undefined;
}

interface ParsedTrailLength {
  trailLengthText?: string;
  trailLengthMinMiles?: number;
  trailLengthMaxMiles?: number;
}

// Capture group: digits with optional decimal — both range bounds and fixed
// values flow through it. Inline so reviewers don't have to hop to a const.
function parseTrailLength(raw: string | undefined): ParsedTrailLength {
  if (!raw) return {};
  // Strip a trailing unit suffix for numeric parsing only — keep the
  // verbatim string in trailLengthText so the UI can render exactly what
  // the source shows ("3-5 Miles" stays "3-5 Miles", not "3-5").
  const numericPart = raw
    .replace(/\s*\(?\s*miles?\s*\)?\s*$/i, "")
    .replace(/\s*mi\s*$/i, "")
    .trim();

  const range = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(numericPart);
  if (range) {
    const min = Number.parseFloat(range[1]);
    const max = Number.parseFloat(range[2]);
    return {
      trailLengthText: raw,
      trailLengthMinMiles: min,
      trailLengthMaxMiles: max,
    };
  }
  const fixed = /^(\d+(?:\.\d+)?)$/.exec(numericPart);
  if (fixed) {
    const n = Number.parseFloat(fixed[1]);
    return {
      trailLengthText: raw,
      trailLengthMinMiles: n,
      trailLengthMaxMiles: n,
    };
  }
  // Unparseable (TBD, ?, ranges-with-units, etc.): preserve the verbatim
  // string for display, but leave numerics undefined so future filter/sort
  // doesn't false-bucket the event.
  return { trailLengthText: raw };
}

// Shiggy Scale is 1–5. Reject anything outside that integer range, including
// "TBD"/"?"/floats — better to drop the field than store ambiguous data.
function parseShiggyScale(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /^(\d+)$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isInteger(n) || n < 1 || n > 5) return undefined;
  return n;
}

/**
 * Burlington Hash House Harriers (BurlyH3) Wix Site Scraper
 *
 * Scrapes burlingtonh3.com/hareline via the NAS headless browser rendering
 * service. The site is built on Wix, which renders content via JavaScript.
 *
 * Event data is extracted from embedded Google Calendar "Add to Calendar" links
 * which contain structured data (title, dates, location, details) as URL params.
 */
export class BurlingtonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl = source.url || "https://www.burlingtonh3.com/hareline";

    const page = await fetchBrowserRenderedPage(harelineUrl, {
      waitFor: "body",
      timeout: 20000,
    });

    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let rowIndex = 0;

    // Find all Google Calendar render links
    $('a[href*="google.com/calendar/render"]').each((_i, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      try {
        const event = parseCalendarLink(href, harelineUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing calendar link at row ${rowIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: rowIndex,
            error: String(err),
            rawText: href.slice(0, 2000),
          },
        ];
      }
      rowIndex++;
    });

    // Deduplicate by run number (Wix may render duplicate elements)
    const seen = new Set<number>();
    const dedupedEvents: RawEventData[] = [];
    for (const event of events) {
      if (event.runNumber && seen.has(event.runNumber)) continue;
      if (event.runNumber) seen.add(event.runNumber);
      dedupedEvents.push(event);
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: dedupedEvents,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        calendarLinksFound: rowIndex,
        eventsParsed: dedupedEvents.length,
        fetchDurationMs,
      },
    };
  }
}
