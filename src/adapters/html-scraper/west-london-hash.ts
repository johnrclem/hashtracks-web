import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { chronoParseDate, extractAddressWithAi, extractUkPostcode, googleMapsSearchUrl, isPlaceholder, validateSourceUrl } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * Parse run number from WLH3 heading text. The site uses both "Run Number"
 * and (since Dec 2026) "Run No":
 *   "Run Number 2081 – 19 February 2026-Clapham Junction" → 2081
 *   "Run No 2131 – 21 January 2027 – location TBA" → 2131
 */
const RUN_NUMBER_RE = /Run\s*(?:Number|No\.?)\s*(\d+)/i;
export function parseRunNumberFromHeading(heading: string): number | null {
  const match = RUN_NUMBER_RE.exec(heading);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Parse date from WLH3 heading text using chrono-node.
 * Handles: "Run Number 2081 – 19 February 2026-Clapham Junction"
 */
export function parseDateFromHeading(heading: string): string | null {
  return chronoParseDate(heading, "en-GB");
}

// "19 February 2026", "7 January  2027", "09 July" — the heading's date text.
const HEADING_DATE_RE = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+20\d{2})?/i;
// "12.15 start time" / "12:15 start" — a non-default start time segment.
const START_TIME_SEGMENT_RE = /^(\d{1,2})[.:](\d{2})\s*(am|pm)?\s*start(?:\s+time)?$/i;
// "hare needed" segments are a hare CTA, not a venue.
const HARE_NEEDED_RE = /^hares?\s+needed!?$/i;

/**
 * Split the text after the heading's date into its dash-separated segments.
 * Headings come in several shapes:
 *   "Run Number 2081 – 19 February 2026-Clapham Junction"   (unspaced dash)
 *   "Run Number 2120 – 5 November 2026 – Chiswick NR"       (spaced en dash)
 *   "Run No 2128 – 31 December 2026 – location TBA – 12.15 start time"
 * Only spaced dashes separate segments after the first, so hyphenated names
 * like "Ealing Common-AGPU" stay intact.
 */
function headingSegments(heading: string): string[] {
  const m = HEADING_DATE_RE.exec(heading);
  if (!m) return [];
  const rest = heading.slice(m.index + m[0].length).replace(/^[\s\-–—]+/, "");
  return rest
    .split(/\s+[-–—]\s+/)
    .map((seg) => seg.trim())
    .filter(Boolean);
}

/**
 * Extract the location / theme from WLH3 heading text (after the date).
 * "Run Number 2081 – 19 February 2026-Clapham Junction" → "Clapham Junction"
 * Placeholder ("location TBA"), hare-needed and start-time segments are dropped.
 */
export function parseLocationFromHeading(heading: string): string | null {
  const parts = headingSegments(heading).filter((seg) => {
    if (START_TIME_SEGMENT_RE.test(seg) || HARE_NEEDED_RE.test(seg)) return false;
    // Filter placeholder values like "TBA" or "Location TBA"
    return !isPlaceholder(seg.replace(/^Location\s+/i, ""));
  });
  return parts.length > 0 ? parts.join(" – ") : null;
}

/**
 * Non-default start time from the heading ("– 12.15 start time" on the
 * Christmas/New Year lunchtime runs), as "HH:MM"; undefined when absent.
 */
export function parseStartTimeFromHeading(heading: string): string | undefined {
  for (const seg of headingSegments(heading)) {
    const m = START_TIME_SEGMENT_RE.exec(seg);
    if (!m) continue;
    let hour = Number.parseInt(m[1], 10);
    const suffix = m[3]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour > 23) return undefined;
    return `${String(hour).padStart(2, "0")}:${m[2]}`;
  }
  return undefined;
}

/** @deprecated Use extractUkPostcode from ../utils instead */
export const extractPostcode = extractUkPostcode;

const mapsUrl = googleMapsSearchUrl;

/**
 * Parse a single run list item into RawEventData.
 */
export function parseRunItem(
  $: CheerioAPI,
  $item: Cheerio<AnyNode>,
  baseUrl: string,
): RawEventData | null {
  // Title heading: <h4><a href="...">Run Number 2081 – 19 February 2026-Clapham Junction</a></h4>
  const headingLink = $item.find("h4 a, h5 a, h3 a").first();
  const headingText = headingLink.text().trim() || $item.find("h4, h5, h3").first().text().trim();
  if (!headingText) return null;

  const runNumber = parseRunNumberFromHeading(headingText);
  const date = parseDateFromHeading(headingText);
  if (!date) return null;

  const locationFromHeading = parseLocationFromHeading(headingText);

  // Source URL: permalink from the heading link
  const href = headingLink.attr("href");
  const sourceUrl = href
    ? new URL(href, baseUrl).toString()
    : baseUrl;

  // Parse paragraphs for hares and venue details
  let hares: string | undefined;
  let venueAddress: string | undefined;
  let postcode: string | undefined;
  let longParagraphText: string | undefined; // For AI extraction fallback

  $item.find("p").each((_i, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    // Hares line: "Hares - Name and Name" or "Hare – Name"
    const hareMatch = text.match(/^Hares?\s*[-–—]\s*(.+)/i);
    if (hareMatch) {
      hares = hareMatch[1].trim();
      return;
    }

    // Check for postcode (likely the venue/address line)
    const pc = extractPostcode(text);
    if (pc && !venueAddress) {
      if (text.length > 120) {
        // Long paragraph with embedded postcode — use postcode as fallback,
        // store full text for AI extraction in post-processing
        venueAddress = pc;
        longParagraphText = text;
      } else {
        venueAddress = text;
      }
      postcode = pc;
    }
  });

  // Build location: prefer venue address, fall back to heading location (filter placeholders)
  const filteredVenue = venueAddress && !isPlaceholder(venueAddress) ? venueAddress : null;
  const location = filteredVenue || locationFromHeading || undefined;
  const locationUrl = postcode ? mapsUrl(postcode) : (locationFromHeading ? mapsUrl(locationFromHeading) : undefined);

  // Build title. No "- TBD" suffix when the heading names no place (#2619).
  let title = headingText;
  if (runNumber) {
    title = locationFromHeading
      ? `WLH3 Run #${runNumber} - ${locationFromHeading}`
      : `WLH3 Run #${runNumber}`;
  }

  const event: RawEventData & { _longParagraph?: string } = {
    date,
    kennelTags: ["wlh3"],
    runNumber: runNumber ?? undefined,
    title,
    hares,
    location,
    locationUrl,
    startTime: parseStartTimeFromHeading(headingText) ?? "19:15",
    sourceUrl,
  };
  // Attach long paragraph text for AI extraction (stripped before return to caller)
  if (longParagraphText) event._longParagraph = longParagraphText;
  return event;
}

/**
 * West London Hash (WLH3) Website Scraper
 *
 * Scrapes westlondonhash.com for upcoming runs. The site is WordPress with
 * block-based post templates. Run entries are list items with h4 headings
 * containing run number, date, and location. Supports pagination.
 */
export class WestLondonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  private maxPages = 3;

  /** Fetch a page and return its HTML, or record an error. */
  private async fetchPageWithErrorHandling(
    url: string,
    errorDetails: ErrorDetails,
  ): Promise<string | null> {
    try {
      const response = await safeFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url, status: response.status, message },
        ];
        return null;
      }
      return await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [
        ...(errorDetails.fetch ?? []),
        { url, message },
      ];
      return null;
    }
  }

  /** Find run item elements from the page using multiple strategies. */
  private findRunItemElements($: CheerioAPI): Cheerio<AnyNode> {
    let items = $(".wp-block-post-template > li");
    if (items.length === 0) items = $("article");
    if (items.length === 0) {
      items = $("li").filter((_i, el) => {
        return RUN_NUMBER_RE.test($(el).find("h4, h5").text());
      });
    }
    return items;
  }

  /** Find the "Next Page" pagination link. */
  private findNextPageUrl($: CheerioAPI, baseUrl: string): string | null {
    const nextLink = $("a").filter((_i, el) => {
      return /next\s*page/i.test($(el).text());
    });
    if (nextLink.length > 0) {
      const nextHref = nextLink.attr("href");
      return nextHref ? new URL(nextHref, baseUrl).toString() : null;
    }
    return null;
  }

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://westlondonhash.com/runs/";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;
    let pagesFetched = 0;

    const fetchStart = Date.now();
    let currentUrl: string | null = baseUrl;

    while (currentUrl && pagesFetched < this.maxPages) {
      const html = await this.fetchPageWithErrorHandling(currentUrl, errorDetails);
      if (!html) {
        if (pagesFetched === 0) {
          const lastErr = errorDetails.fetch?.[errorDetails.fetch.length - 1];
          return { events: [], errors: [lastErr?.message ?? "Fetch failed"], errorDetails };
        }
        break;
      }

      if (pagesFetched === 0) {
        structureHash = generateStructureHash(html);
      }

      const $ = cheerio.load(html);
      pagesFetched++;

      const items = this.findRunItemElements($);

      items.each((i, el) => {
        try {
          const event = parseRunItem($, $(el), baseUrl);
          if (event) {
            events.push(event);
          } else {
            const text = $(el).find("h4, h5").text().trim().slice(0, 80);
            errorDetails.parse = [
              ...(errorDetails.parse ?? []),
              { row: i, section: `page-${pagesFetched}`, error: `Could not parse: ${text}`, rawText: $(el).text().trim().slice(0, 2000) },
            ];
          }
        } catch (err) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: `page-${pagesFetched}`, error: String(err), rawText: $(el).text().trim().slice(0, 2000) },
          ];
        }
      });

      const nextUrl = this.findNextPageUrl($, baseUrl);
      try {
        if (nextUrl) validateSourceUrl(nextUrl);
        currentUrl = nextUrl;
      } catch {
        currentUrl = null; // Pagination URL failed SSRF validation
      }
    }

    // Post-processing: for events with long paragraph text that fell back to bare postcode,
    // attempt AI extraction to get a better address
    for (const event of events) {
      const extended = event as RawEventData & { _longParagraph?: string };
      if (extended._longParagraph) {
        try {
          const aiAddr = await extractAddressWithAi(extended._longParagraph);
          if (aiAddr) event.location = aiAddr;
        } catch {
          // Keep postcode as fallback
        }
        delete extended._longParagraph;
      }
    }

    const fetchDurationMs = Date.now() - fetchStart;
    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        pagesFetched,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
