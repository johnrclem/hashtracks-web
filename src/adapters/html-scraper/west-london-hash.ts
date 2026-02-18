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
import { generateStructureHash } from "@/pipeline/structure-hash";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Parse run number from WLH3 heading text.
 * "Run Number 2081 – 19 February 2026-Clapham Junction" → 2081
 */
export function parseRunNumberFromHeading(heading: string): number | null {
  const match = heading.match(/Run\s*Number\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse date from WLH3 heading text.
 * "Run Number 2081 – 19 February 2026-Clapham Junction" → "2026-02-19"
 * Also handles: "Run Number 2082 – 26 February 2026-North Harrow"
 */
export function parseDateFromHeading(heading: string): string | null {
  // Match "DD Month YYYY" pattern after the dash separator
  const match = heading.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthNum = MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);

  if (!monthNum || day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Extract location name from WLH3 heading text (after the date).
 * "Run Number 2081 – 19 February 2026-Clapham Junction" → "Clapham Junction"
 * The location comes after "YYYY" immediately followed by a hyphen/dash (no space).
 */
export function parseLocationFromHeading(heading: string): string | null {
  // Match year (20xx) immediately followed by a dash then location text (starts with letter)
  // Key: no whitespace between year and dash — "2026-Clapham" not "2081 – 19 Feb"
  const match = heading.match(/20\d{2}[-–—]([A-Za-z].+)$/);
  return match ? match[1].trim() : null;
}

/**
 * Extract UK postcode from a text string.
 * UK postcodes: "SE11 5JA", "SW18 2SS", "N1 9AA", "EC1A 1BB"
 */
export function extractPostcode(text: string): string | null {
  const match = text.match(/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Generate a Google Maps search URL from a location string.
 */
function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

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
      venueAddress = text;
      postcode = pc;
    }
  });

  // Build location: prefer venue address, fall back to heading location
  const location = venueAddress || locationFromHeading || undefined;
  const locationUrl = postcode ? mapsUrl(postcode) : (locationFromHeading ? mapsUrl(locationFromHeading) : undefined);

  // Build title
  const title = runNumber
    ? `WLH3 Run #${runNumber} - ${locationFromHeading || "TBD"}`
    : headingText;

  return {
    date,
    kennelTag: "WLH3",
    runNumber: runNumber ?? undefined,
    title,
    hares,
    location,
    locationUrl,
    startTime: "19:15",
    sourceUrl,
  };
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
      let html: string;
      try {
        const response = await fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
          },
        });
        if (!response.ok) {
          const message = `HTTP ${response.status}: ${response.statusText}`;
          errorDetails.fetch = [
            ...(errorDetails.fetch ?? []),
            { url: currentUrl, status: response.status, message },
          ];
          if (pagesFetched === 0) {
            return { events: [], errors: [message], errorDetails };
          }
          break;
        }
        html = await response.text();
      } catch (err) {
        const message = `Fetch failed: ${err}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: currentUrl, message },
        ];
        if (pagesFetched === 0) {
          return { events: [], errors: [message], errorDetails };
        }
        break;
      }

      // Only generate structure hash from first page
      if (pagesFetched === 0) {
        structureHash = generateStructureHash(html);
      }

      const $ = cheerio.load(html);
      pagesFetched++;

      // Find run items: try WordPress post template list items, then articles
      let items = $(".wp-block-post-template > li");
      if (items.length === 0) {
        items = $("article");
      }
      if (items.length === 0) {
        // Fallback: look for any list items with h4 containing "Run Number"
        items = $("li").filter((_i, el) => {
          return $(el).find("h4, h5").text().includes("Run Number");
        });
      }

      items.each((i, el) => {
        try {
          const event = parseRunItem($, $(el), baseUrl);
          if (event) {
            events.push(event);
          } else {
            const text = $(el).find("h4, h5").text().trim().slice(0, 80);
            errorDetails.parse = [
              ...(errorDetails.parse ?? []),
              { row: i, section: `page-${pagesFetched}`, error: `Could not parse: ${text}` },
            ];
          }
        } catch (err) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: `page-${pagesFetched}`, error: String(err) },
          ];
        }
      });

      // Find pagination "Next Page" link
      const nextLink = $("a").filter((_i, el) => {
        return /next\s*page/i.test($(el).text());
      });
      if (nextLink.length > 0) {
        const nextHref = nextLink.attr("href");
        currentUrl = nextHref ? new URL(nextHref, baseUrl).toString() : null;
      } else {
        currentUrl = null;
      }
    }

    const fetchDurationMs = Date.now() - fetchStart;

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

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
