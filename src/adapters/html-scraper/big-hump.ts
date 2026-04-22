/**
 * Big Hump Hash House Harriers (BH4) Scraper — St. Louis, MO
 *
 * Scrapes big-hump.com for hash events from two pages:
 *
 * 1. **Hareline** (`hareline.php`) — future events with W3.CSS cards:
 *    - Header: `<header class="w3-container w3-green"><h3>Wednesday 04/01/2026
 *      <span class="w3-text-amber">#1991</span></h3></header>`
 *    - Body h4: "Locknut Monster's April Fools' Trail @ Lemay"
 *    - Body span.w3-small: description text with circle-up time, address, hare info
 *
 * 2. **Past Hashes** (`hashresults.php?year=YYYY`) — historical events with
 *    attendance lists, hare tagging, and detail page links. Enabled via
 *    `source.config.includeHistory`.
 *
 * Date is MM/DD/YYYY in the header h3.
 * Run number is #NNNN in span.w3-text-amber or span.w3-text-red.
 * Title h4 text is split on last " @ " for hare(s)/location.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, buildDateWindow, stripHtmlTags, isPlaceholder } from "../utils";

/** Config stored in source.config JSON */
interface BigHumpConfig {
  includeHistory?: boolean;
  /** Override year range for full backfill; default: computed from date window */
  historyYearRange?: [number, number];
}

/**
 * Parse date and run number from a header h3 text.
 *
 * Input: "Wednesday 04/01/2026 #1991" or just the h3 inner text.
 * Returns date as "YYYY-MM-DD" and optional run number.
 */
export function parseEventHeader(headerText: string): {
  date: string | null;
  runNumber?: number;
} {
  // Date: MM/DD/YYYY
  const dateMatch = /(\d{2})\/(\d{2})\/(\d{4})/.exec(headerText);
  const date = dateMatch
    ? `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`
    : null;

  // Run number: #NNNN
  const runMatch = /#(\d+)/.exec(headerText);
  const runNumber = runMatch
    ? Number.parseInt(runMatch[1], 10)
    : undefined;

  return { date, runNumber };
}

/**
 * Extract hare name(s) from a "Hare @ Location" title prefix.
 *
 * BH4 titles frequently embed theme text between the hare and the `@`:
 *   - "Hare's Theme Trail"            (possessive)
 *   - "Theme starring Hare"           (starring)
 *   - "Theme with Hare"               (with)
 *   - "Hare: Theme"                   (colon/dash prefix)
 *   - "Hare Hashyversary"             (anniversary/birthday suffix)
 *
 * Falls through to `undefined` rather than leaking theme text when no rule
 * applies — per #844, an empty hares field is safer than a wrong one.
 */
function extractHaresFromTitlePart(harePart: string): string | undefined {
  if (!harePart) return undefined;

  // Rule 1: "<theme> starring <hare>"
  const starringMatch = /\s+starring\s+(.+)$/i.exec(harePart);
  if (starringMatch) return starringMatch[1].trim();

  // Rule 2: "<theme> with <hare>"
  const withMatch = /\s+with\s+(.+)$/i.exec(harePart);
  if (withMatch) return withMatch[1].trim();

  // Rule 3: "<hare>'s <theme>" (straight + curly + reversed-9 apostrophes).
  // Reject matches whose extracted hare contains digits or more apostrophes —
  // those strings (e.g. "3rd An'al It's Gonna Be May") reproduce the #844
  // truncation bug where the lazy `.+?` stops at an embedded apostrophe.
  const possessiveMatch = /^(.+?)['\u2018\u2019\u201B]s?\s+.+$/i.exec(harePart);
  if (possessiveMatch) {
    const candidate = possessiveMatch[1].trim();
    if (!/[0-9'\u2018\u2019\u201B]/.test(candidate)) return candidate;
  }

  // Rule 4: "<hare>: <theme>" or "<hare> - <theme>" / en-dash / em-dash
  const colonMatch = /^(.+?)\s*[:–—]\s*.+$/.exec(harePart);
  if (colonMatch) return colonMatch[1].trim();
  const dashMatch = /^(.+?)\s+-\s+.+$/.exec(harePart);
  if (dashMatch) return dashMatch[1].trim();

  // Rule 5: "<hare> Hashyversary / Birthday / Bday / turns NN"
  const anniversaryMatch = /^(.+?)\s+(?:Hashy?versary|B[iy]rthday|Bday|turns\s+\d+)\b/i.exec(
    harePart,
  );
  if (anniversaryMatch) return anniversaryMatch[1].trim();

  // Rule 6: clean short name — no digits, no colons, no emoji.
  // Accept only explicit 1–2 word names or pair-joined forms ("X & Y",
  // "X and Y"). Anything longer without a joiner is likely theme text
  // ("Bungle in the Jungle") and falls through to undefined per #844.
  const hasTroublesomeChar = /[:0-9\p{Extended_Pictographic}]/u.test(harePart);
  if (!hasTroublesomeChar) {
    const wordCount = harePart.split(/\s+/).length;
    const hasPairJoiner = /\s(?:&|and)\s/i.test(harePart);
    if (wordCount <= 2 || hasPairJoiner) return harePart;
  }

  // Rule 7: give up — do not guess.
  return undefined;
}

/**
 * Parse h4 title text into hare(s) and location.
 *
 * Format: "Hare Name @ Location" — split on last " @ ".
 * If no " @ " separator, the whole string is the title (hares extracted from description).
 *
 * Returns title, hares, and location.
 */
export function parseEventTitle(h4Text: string): {
  title: string;
  hares?: string;
  location?: string;
} {
  const atIdx = h4Text.lastIndexOf(" @ ");
  if (atIdx === -1) {
    return { title: h4Text.trim() };
  }

  const harePart = h4Text.slice(0, atIdx).trim();
  const locationPart = h4Text.slice(atIdx + 3).trim();
  const locationIsTbd = !locationPart || isPlaceholder(locationPart);

  const hares = extractHaresFromTitlePart(harePart);

  // #754: drop " @ ???" from the title when location is TBD — a trailing TBD
  // placeholder is noise, not a meaningful subtitle. When location IS set,
  // the full "Hare @ Venue" string stays as the title.
  const title = locationIsTbd ? harePart : h4Text.trim();
  const location = locationIsTbd ? undefined : locationPart;

  return { title, hares, location };
}

/**
 * Parse a start time from the description text.
 * Looks for "Circle up: 6:45 p.m." or "Meet to hash: 3pm" patterns.
 * Returns "HH:MM" or undefined.
 */
function parseTimeFromDescription(text: string): string | undefined {
  const match =
    /(?:Circle\s*up|Meet\s*(?:to\s*hash)?|Hash\s*(?:at)?)\s*:?\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?\s*m\.?)/i.exec(
      text,
    );
  if (!match) return undefined;

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] || "00";
  const ampm = match[3].replace(/[\s.]/g, "").toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Parse a location/address from description text.
 * Looks for street address patterns (e.g., "3661 Reavis Barracks Rd, St Louis, MO 63125").
 */
function parseLocationFromDescription(text: string): string | undefined {
  const match = /\d+\s+[\w\s]+(?:St|Ave|Rd|Dr|Blvd|Ln|Way|Ct|Pl|Pkwy|Ter|Terr),?\s*[\w\s]+,?\s*(?:MO|IL)\s*\d{5}/i.exec(text);
  return match ? match[0].trim() : undefined;
}

/**
 * Parse hare name(s) from description text.
 *
 * Requires the hare label to be at start of a line with a mandatory colon.
 * Without the anchor + required colon, the loose `Hares?` prefix used to
 * match the word "hares" mid-sentence (e.g., "the shiggyfest hares had us
 * in Fenton…"), pulling in half a paragraph as the hare name. See #519.
 * The caller must preserve paragraph newlines — cheerio's `.text()` strips
 * them, which defeats the `\n` anchor here; use `stripHtmlTags(.., "\n")`.
 */
function parseHaresFromDescription(text: string): string | undefined {
  const match = /^\s*Hares?\s*(?:\([^)]*\))?\s*:\s*(.+?)$/im.exec(text);
  if (!match) return undefined;
  const name = match[1].trim();
  // "away: …" is departure time, not a hare name
  if (/^away/i.test(name)) return undefined;
  return name || undefined;
}

// ─── History page parsing ───────────────────────────────────────────────────

/**
 * Extract hare names from a history card's attendance `<ul>`.
 *
 * Hares are marked with `<strong> (<i class='fa fa-carrot'> hare</i>)</strong>`
 * after their `<a>` name link.
 */
export function parseAttendanceHares(
  $card: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
): { hares: string[]; attendeeCount: number } {
  const hares: string[] = [];
  let attendeeCount = 0;

  const $ul = $card.find("ul");
  if (!$ul.length) return { hares, attendeeCount };

  $ul.find("li").each((_, li) => {
    attendeeCount++;
    const $li = $(li);
    // Check for hare marker: <strong> containing "hare" text or <i class="fa-carrot">
    const hasHareMarker =
      $li.find("i.fa-carrot").length > 0 ||
      /\bhare\b/i.test($li.find("strong").text());
    if (hasHareMarker) {
      const name = $li.find("a").first().text().trim();
      if (name) hares.push(name);
    }
  });

  return { hares, attendeeCount };
}

/**
 * Parse a single history card (div.w3-card) from hashresults.php.
 *
 * Reuses parseEventHeader and parseEventTitle, plus extracts hares from
 * the attendance list and builds a sourceUrl from the detail page link.
 */
export function parseHistoryCard(
  $card: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  baseUrl: string,
): RawEventData | null {
  const header = $card.find("header h3");
  if (!header.length) return null;

  const { date, runNumber } = parseEventHeader(header.text().trim());
  if (!date) return null;

  // Find the title h4 in the content column (skip "Attendance:" h4 in sidebar)
  const contentH4 = $card.find("div.w3-col.m7 h4, div.w3-col.l7 h4").first();
  const titleText = contentH4.length
    ? contentH4.text().trim()
    : $card.find("h4").first().text().trim();
  if (!titleText || titleText === "Attendance:") return null;

  const { title, hares: titleHares, location } = parseEventTitle(titleText);

  // Extract hares from attendance list (more authoritative than title)
  const { hares: attendanceHares, attendeeCount } = parseAttendanceHares($card, $);

  // Build sourceUrl from detail page link (use URL constructor for safe resolution)
  const detailLink = $card.find("a[href*='runinfo.php']").attr("href");
  const sourceUrl = detailLink
    ? new URL(detailLink, baseUrl).toString()
    : `${baseUrl}/hashresults.php`;

  // Attendance hares override title hares when available
  const hares = attendanceHares.length > 0
    ? attendanceHares.join(", ")
    : titleHares;

  const event: RawEventData = {
    date,
    kennelTag: "bh4",
    runNumber,
    title,
    hares,
    location,
    sourceUrl,
  };

  if (attendeeCount > 0) {
    event.description = `Attendance: ${attendeeCount} hashers`;
  }

  return event;
}

/**
 * Parse all event cards from a history page HTML string.
 */
export function parseHistoryPage(
  html: string,
  baseUrl: string,
): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("div.w3-card").each((_, el) => {
    const event = parseHistoryCard($(el), $, baseUrl);
    if (event) events.push(event);
  });

  return events;
}

/**
 * Fetch multiple year pages sequentially with rate limiting.
 * Returns aggregated events and errors.
 */
async function fetchHistoryYears(
  baseUrl: string,
  years: number[],
): Promise<{
  events: RawEventData[];
  errors: string[];
  fetchErrors: NonNullable<ErrorDetails["fetch"]>;
}> {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const fetchErrors: NonNullable<ErrorDetails["fetch"]> = [];

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const url = new URL(`/hashresults.php?year=${year}`, baseUrl).toString();

    // Rate limit: 500ms delay between requests to be polite to small PHP site
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const page = await fetchHTMLPage(url);
    if (page.ok) {
      const yearEvents = parseHistoryPage(page.html, baseUrl);
      events.push(...yearEvents);
    } else {
      errors.push(`Failed to fetch year ${year}: ${page.result.errors.join(", ")}`);
      if (page.result.errorDetails?.fetch) {
        fetchErrors.push(...page.result.errorDetails.fetch);
      }
    }
  }

  return { events, errors, fetchErrors };
}

/**
 * Compute which years overlap with the date window.
 * Returns array of years to fetch, e.g. [2025, 2026].
 */
function computeYearsInWindow(
  minDate: Date,
  maxDate: Date,
  config: BigHumpConfig,
): number[] {
  if (config.historyYearRange) {
    const [startYear, endYear] = config.historyYearRange;
    const years: number[] = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);
    return years;
  }

  const startYear = Math.max(1999, minDate.getFullYear());
  const endYear = Math.min(new Date().getFullYear(), maxDate.getFullYear());
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return years;
}

/**
 * Safely parse and validate BigHumpConfig from source.config JSON.
 * Returns safe defaults for missing or malformed values.
 */
function parseBigHumpConfig(raw: unknown): BigHumpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;

  const includeHistory = obj.includeHistory === true;

  let historyYearRange: [number, number] | undefined;
  if (
    Array.isArray(obj.historyYearRange) &&
    obj.historyYearRange.length === 2 &&
    typeof obj.historyYearRange[0] === "number" &&
    typeof obj.historyYearRange[1] === "number"
  ) {
    historyYearRange = [obj.historyYearRange[0], obj.historyYearRange[1]];
  }

  return { includeHistory, historyYearRange };
}

/**
 * Big Hump H3 Scraper
 *
 * Scrapes big-hump.com/hareline.php for upcoming events, and optionally
 * big-hump.com/hashresults.php?year=YYYY for historical events when
 * source.config.includeHistory is true.
 */
export class BigHumpAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = parseBigHumpConfig(source.config);
    const harelineUrl =
      source.url || "http://www.big-hump.com/hareline.php";
    const baseUrl = new URL(harelineUrl).origin;

    const { minDate, maxDate } = buildDateWindow(options?.days);
    const isInWindow = (e: RawEventData) => {
      const eventDate = new Date(e.date + "T12:00:00Z");
      return eventDate >= minDate && eventDate <= maxDate;
    };

    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // ── Step 1: Fetch hareline (always) ──
    const page = await fetchHTMLPage(harelineUrl);

    const harelineEvents: RawEventData[] = [];
    let structureHash: string | undefined;
    let fetchDurationMs: number | undefined;

    if (page.ok) {
      structureHash = page.structureHash;
      fetchDurationMs = page.fetchDurationMs;
      const { $ } = page;

      $("div.w3-card").each((i, el) => {
        try {
          const $card = $(el);
          const header = $card.find("header h3");
          if (!header.length) return;

          const headerText = header.text().trim();
          const { date, runNumber } = parseEventHeader(headerText);
          if (!date) return;

          const h4 = $card.find("h4").first();
          const h4Text = h4.text().trim();
          if (!h4Text) return;

          const { title: titleFromH4, hares: titleHares, location: titleLocation } =
            parseEventTitle(h4Text);

          // Preserve paragraph breaks so the labeled-field regexes below can
          // anchor against `\n`; cheerio's `.text()` strips them (#519).
          const descSpan = $card.find("span.w3-small");
          const descText = stripHtmlTags(descSpan.html() ?? "", "\n");

          const descTime = parseTimeFromDescription(descText);
          const descLocation = parseLocationFromDescription(descText);
          const descHares = parseHaresFromDescription(descText);

          const hares = descHares || titleHares;
          const location = descLocation || titleLocation;

          // #828: "Open @ ???" placeholder rows — skip. Key off raw h4Text so
          // a real hasher literally named "Open" still gets ingested if their
          // venue is known. String split avoids a ReDoS-flagged regex with
          // multiple \s* quantifiers + alternation (SonarCloud S5852).
          const [h4Hare, ...h4Rest] = h4Text.trim().split("@");
          const h4Venue = h4Rest.join("@").trim().toLowerCase();
          const placeholderVenues = new Set(["", "tbd", "tba", "n/a"]);
          const allQuestionMarks = h4Venue.length > 0 && [...h4Venue].every((c) => c === "?");
          const isUnknownVenue = placeholderVenues.has(h4Venue) || allQuestionMarks;
          if (h4Hare.trim().toLowerCase() === "open" && isUnknownVenue) return;

          // #828: h4 is "Hare @ Venue" — rebuild as "BH4 #N @ Venue" so hares don't double as title.
          let title = titleFromH4;
          if (runNumber) {
            title = location ? `BH4 #${runNumber} @ ${location}` : `BH4 #${runNumber}`;
          }

          harelineEvents.push({
            date,
            kennelTag: "bh4",
            runNumber,
            title,
            hares,
            location,
            startTime: descTime,
            sourceUrl: harelineUrl,
            description: descText || undefined,
          });
        } catch (err) {
          allErrors.push(`Error parsing hareline card ${i}: ${err}`);
          (errorDetails.parse ??= []).push({
            row: i,
            error: String(err),
          });
        }
      });
    } else {
      allErrors.push(...page.result.errors);
      if (page.result.errorDetails?.fetch) {
        errorDetails.fetch = [...(errorDetails.fetch ?? []), ...page.result.errorDetails.fetch];
      }
    }

    // ── Step 2: Fetch history (when enabled) ──
    let historyEvents: RawEventData[] = [];
    let historyYearsFetched = 0;

    if (config.includeHistory) {
      const years = computeYearsInWindow(minDate, maxDate, config);
      historyYearsFetched = years.length;

      if (years.length > 0) {
        const historyResult = await fetchHistoryYears(baseUrl, years);
        historyEvents = historyResult.events;

        if (historyResult.errors.length > 0) {
          allErrors.push(...historyResult.errors);
        }
        if (historyResult.fetchErrors.length > 0) {
          errorDetails.fetch = [...(errorDetails.fetch ?? []), ...historyResult.fetchErrors];
        }
      }
    }

    // ── Step 3: Combine and dedup (hareline wins) ──
    const harelineKeys = new Set(
      harelineEvents.map((e) => `${e.date}|${e.runNumber ?? ""}`),
    );
    const dedupedHistory = historyEvents.filter(
      (e) => !harelineKeys.has(`${e.date}|${e.runNumber ?? ""}`),
    );
    const historyDeduped = historyEvents.length - dedupedHistory.length;

    const allEvents = [...harelineEvents, ...dedupedHistory];

    // ── Step 4: Filter by date window ──
    const filteredEvents = allEvents.filter(isInWindow);

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: filteredEvents,
      errors: allErrors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        harelineEventsParsed: harelineEvents.length,
        historyEventsParsed: historyEvents.length,
        historyYearsFetched,
        historyDeduped,
        eventsAfterWindow: filteredEvents.length,
        includeHistory: !!config.includeHistory,
        fetchDurationMs,
      },
    };
  }
}
