import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { buildUrlVariantCandidates, decodeEntities } from "../utils";
import { safeFetch } from "../safe-fetch";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Infer the year for a month/day when the source omits the year.
 * Picks the year that places the date closest to `now` (within ±6 months).
 *   - If the candidate date with the current year is >6 months in the future → previous year
 *   - If it's >6 months in the past → next year
 *   - Otherwise → current year
 *
 * Exported for testing.
 */
export function inferYear(
  monthNum: number,
  day: number,
  now: Date = new Date(),
): number {
  const currentYear = now.getFullYear();
  const candidate = new Date(Date.UTC(currentYear, monthNum - 1, day));
  const diffMs = candidate.getTime() - now.getTime();
  const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

  if (diffMs > SIX_MONTHS_MS) return currentYear - 1;
  if (diffMs < -SIX_MONTHS_MS) return currentYear + 1;
  return currentYear;
}

/**
 * Parse a date from Enfield Hash text.
 *
 * Formats with explicit year:
 *   "Wednesday 18th March 2026" → "2026-03-18"
 *   "18th March 2026" → "2026-03-18"
 *   "March 18, 2026" → "2026-03-18"
 *   "18/03/2026" → "2026-03-18"
 *
 * Formats without year (new site format):
 *   "Wed 25 February" → infers year via inferYear()
 *   "25 February" → infers year via inferYear()
 */
export function parseEnfieldDate(text: string, now?: Date): string | null {
  // Try DD/MM/YYYY format first
  const numericMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    const year = parseInt(numericMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try UK format with year: "DDth Month YYYY" (e.g., "18th March 2026")
  const ukMatch = text.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/i,
  );
  if (ukMatch) {
    const day = parseInt(ukMatch[1], 10);
    const monthNum = MONTHS[ukMatch[2].toLowerCase()];
    const year = parseInt(ukMatch[3], 10);
    if (monthNum && day >= 1 && day <= 31) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try US format: "Month DD, YYYY" (e.g., "March 18, 2026")
  const usMatch = text.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (usMatch) {
    const monthNum = MONTHS[usMatch[1].toLowerCase()];
    if (monthNum) {
      const day = parseInt(usMatch[2], 10);
      const year = parseInt(usMatch[3], 10);
      if (day >= 1 && day <= 31) {
        return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  // Try year-less format: "DD Month" or "DDth Month" (e.g., "25 February", "Wed 25 February")
  // Negative lookahead ensures we don't match dates that already have a year (handled above)
  const noYearMatch = text.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+)(?!\s+\d{4})/i,
  );
  if (noYearMatch) {
    const day = parseInt(noYearMatch[1], 10);
    const monthNum = MONTHS[noYearMatch[2].toLowerCase()];
    if (monthNum && day >= 1 && day <= 31) {
      const year = inferYear(monthNum, day, now);
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Parse labeled fields from an Enfield Hash blog post body.
 *
 * Handles structured posts with labels:
 *   "Date: Wednesday 18th March 2026"
 *   "Pub: The King's Head"
 *   "Station: Enfield Chase"
 *   "Hare: Name"
 *
 * Also handles unstructured prose (new site format):
 *   "Rose and Crown pub, Clay Hill, Enfield. P trail from Gordon Hill station."
 */
export function parseEnfieldBody(text: string, now?: Date): {
  date?: string;
  hares?: string;
  location?: string;
  station?: string;
} {
  // Stop pattern: only match label words when followed by a colon (i.e., the start
  // of a new labeled field), not bare words inside values like "The Station Hotel"
  const labelBoundary = "(?:Date|When|Pub|Where|Location|Station|Hares?|Start|Time|Meet)\\s*:";
  const stopPattern = `(?=${labelBoundary}|\\n|$)`;

  // Date from "Date:" or "When:" label
  const dateMatch = text.match(new RegExp(`(?:Date|When):\\s*(.+?)${stopPattern}`, "i"));
  const date = dateMatch ? parseEnfieldDate(dateMatch[1].trim(), now) : parseEnfieldDate(text, now);

  // Hare from "Hare:" or "Hares:" label
  const hareMatch = text.match(new RegExp(`Hares?:\\s*(.+?)${stopPattern}`, "i"));
  let hares: string | undefined;
  if (hareMatch) {
    const haresText = hareMatch[1].trim();
    if (!/tba|tbd|tbc|needed|required/i.test(haresText)) {
      hares = haresText;
    }
  }

  // Location from "Pub:" or "Where:" or "Location:" label
  const pubMatch = text.match(new RegExp(`(?:Pub|Where|Location|Venue):\\s*(.+?)${stopPattern}`, "i"));
  let location = pubMatch ? pubMatch[1].trim() : undefined;

  // Station from "Station:" label
  const stationMatch = text.match(new RegExp(`Station:\\s*(.+?)${stopPattern}`, "i"));
  let station = stationMatch ? stationMatch[1].trim() : undefined;

  // Fallback: extract station from prose like "P trail from Gordon Hill station"
  if (!station) {
    const proseStation = text.match(/trail from\s+(.+?)\s+station/i);
    if (proseStation) {
      station = proseStation[1].trim();
    }
  }

  // Fallback: extract location from prose like "running from The Wonder"
  if (!location) {
    const proseLocation = text.match(/running from\s+(.+?)(?:[,.]|$)/i);
    if (proseLocation) {
      location = proseLocation[1].trim();
    }
  }

  return {
    date: date ?? undefined,
    hares,
    location: location && !/^tba|^tbd|^tbc/i.test(location) ? location : undefined,
    station: station && !/^tba|^tbd|^tbc/i.test(station) ? station : undefined,
  };
}

/**
 * Extract a run number from an Enfield Hash title.
 *   "Run 318 - Wed 25 February" → 318
 */
function extractRunNumber(title: string): number | undefined {
  const match = title.match(/Run\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Process a single post into a RawEventData.
 * Returns null if the post cannot be parsed (e.g., missing date).
 */
function processPost(
  titleText: string,
  bodyText: string,
  sourceUrl: string,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
  now?: Date,
): RawEventData | null {
  const bodyFields = parseEnfieldBody(bodyText, now);

  if (!bodyFields.date) {
    const titleDate = parseEnfieldDate(titleText, now);
    if (!titleDate) {
      if (bodyText.trim().length > 0) {
        errors.push(
          `Could not parse date from post: ${titleText || "(untitled)"}`,
        );
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: index,
            section: "post",
            field: "date",
            error: `No date found in post: ${titleText || "(untitled)"}`,
            rawText: `Title: ${titleText}\n\n${bodyText}`.slice(0, 2000),
            partialData: { kennelTag: "EH3", title: titleText || undefined },
          },
        ];
      }
      return null;
    }
    bodyFields.date = titleDate;
  }

  const runNumber = extractRunNumber(titleText);
  const descParts: string[] = [];
  if (runNumber) descParts.push(`Run #${runNumber}`);
  if (bodyFields.station) descParts.push(`Nearest station: ${bodyFields.station}`);
  const description = descParts.length > 0 ? descParts.join(". ") : undefined;

  return {
    date: bodyFields.date,
    kennelTag: "EH3",
    title: titleText || undefined,
    hares: bodyFields.hares,
    location: bodyFields.location,
    startTime: "19:30", // EH3: 3rd Wednesday 7:30 PM
    sourceUrl,
    description,
  };
}

/**
 * Enfield Hash House Harriers (EH3) Website Scraper
 *
 * Scrapes enfieldhash.org for run announcements. The site hosts a simple
 * HTML page with .paragraph-box containers, each containing an <h1> title
 * (with run number and date) and <p> paragraphs with details.
 *
 * Monthly kennel (3rd Wednesday, 7:30 PM).
 */
export class EnfieldHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.enfieldhash.org/";
    return this.fetchViaHtmlScrape(baseUrl);
  }

  /** Try fetching HTML from URL variants with browser-like headers. */
  private async tryFetchWithUrlVariants(
    baseUrl: string,
    errorDetails: ErrorDetails,
  ): Promise<{ html: string; fetchUrl: string } | null> {
    const requestHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "max-age=0",
      "Sec-Ch-Ua": '"Chromium";v="124", "Not(A:Brand";v="24", "Google Chrome";v="124"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    };

    const candidateUrls = buildUrlVariantCandidates(baseUrl);

    for (const candidateUrl of candidateUrls) {
      try {
        const response = await safeFetch(candidateUrl, { headers: requestHeaders });

        if (response.ok) {
          const html = await response.text();
          return { html, fetchUrl: candidateUrl };
        }

        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: candidateUrl, status: response.status, message },
        ];

        // Only continue trying variants on 403/404 (host/protocol mismatch)
        if (response.status !== 403 && response.status !== 404) {
          return null;
        }
      } catch (err) {
        const message = `Fetch failed: ${err}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: candidateUrl, message },
        ];
      }
    }

    return null;
  }

  private async fetchViaHtmlScrape(baseUrl: string): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const fetchStart = Date.now();
    const fetchResult = await this.tryFetchWithUrlVariants(baseUrl, errorDetails);

    if (!fetchResult) {
      const last = errorDetails.fetch?.[errorDetails.fetch.length - 1];
      const fallbackMessage = last?.message ?? "Fetch failed";
      return {
        events: [],
        errors: [fallbackMessage],
        errorDetails,
        diagnosticContext: { fetchMethod: "html-scrape" },
      };
    }

    const { html, fetchUrl } = fetchResult;
    const fetchDurationMs = Date.now() - fetchStart;

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // New site structure: .paragraph-box containers with <h1> title
    let posts = $(".paragraph-box").toArray();

    // Fallback: try legacy Blogger selectors in case the site reverts
    if (posts.length === 0) {
      posts = $(".post-outer").toArray();
    }
    if (posts.length === 0) {
      posts = $(".post, .blog-post").toArray();
    }

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      // New format: <h1> inside .paragraph-box
      let titleText = decodeEntities(post.find("h1").first().text().trim());
      let postUrl = fetchUrl;

      // Legacy fallback: Blogger title links
      if (!titleText) {
        const titleEl = post
          .find(".post-title a, .entry-title a, h3.post-title a")
          .first();
        titleText = titleEl.text().trim() ||
          post.find(".post-title, .entry-title, h3").first().text().trim();
        postUrl = titleEl.attr("href") || fetchUrl;
      }

      // Body: combine <p> elements (new format) or find .post-body (legacy)
      const paragraphs = post.find("p").toArray();
      let bodyText: string;
      if (paragraphs.length > 0) {
        bodyText = paragraphs
          .map((p) => $(p).text().trim())
          .filter((t) => t.length > 0 && !/^on\s*on$/i.test(t))
          .join("\n");
      } else {
        const bodyEl = post.find(".post-body, .entry-content").first();
        bodyText = bodyEl.text() || "";
      }

      const event = processPost(
        titleText,
        bodyText,
        postUrl,
        i,
        errors,
        errorDetails,
      );
      if (event) events.push(event);
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
