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
import { chronoParseDate, extractUkPostcode, googleMapsSearchUrl, validateSourceUrl } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * Parse run number from WLH3 heading text.
 * "Run Number 2081 – 19 February 2026-Clapham Junction" → 2081
 */
export function parseRunNumberFromHeading(heading: string): number | null {
  const match = heading.match(/Run\s*Number\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse date from WLH3 heading text using chrono-node.
 * Handles: "Run Number 2081 – 19 February 2026-Clapham Junction"
 */
export function parseDateFromHeading(heading: string): string | null {
  return chronoParseDate(heading, "en-GB");
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
        return $(el).find("h4, h5").text().includes("Run Number");
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
