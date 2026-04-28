/**
 * Norfolk Hash House Harriers (Norfolk H3) HTML Scraper
 *
 * Scrapes norfolkh3.co.uk/trails/ for upcoming runs.
 * The site is a WordPress Block Theme with a post loop query.
 * Each run is a separate post rendered as an <li> inside
 * <ul class="wp-block-post-template">:
 *
 *   <li class="wp-block-post post-XXXX post">
 *     <h3 class="wp-block-post-title">
 *       <a href="...">Run #2139</a>
 *     </h3>
 *     <div class="entry-content wp-block-post-content">
 *       <p>Sunday 29th March 2026, 11am</p>
 *       <p>Venue:<br>The Crown Inn<br>Front Street<br>Trunch<br>NR28 0AH</p>
 *       <p>Hare(s):<br>Woolly and Bagpuss</p>
 *     </div>
 *   </li>
 *
 * The WAF blocks datacenter IPs — uses residential proxy via safeFetch.
 * Biweekly Sunday 11am (winter) / Wednesday 7pm (summer) schedule.
 */
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
import {
  buildUrlVariantCandidates,
  chronoParseDate,
  decodeEntities,
  extractUkPostcode,
  googleMapsSearchUrl,
  parse12HourTime,
  stripPlaceholder,
  buildDateWindow,
} from "../utils";
import { safeFetch } from "../safe-fetch";

const USE_RESIDENTIAL_PROXY = true;
const KENNEL_TAG = "Norfolk H3";

/** Parsed fields from a single Norfolk H3 run block. */
export interface ParsedNorfolkRun {
  runNumber?: number;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM (24-hour)
  location?: string;
  locationUrl?: string;
  hares?: string;
  notes?: string;
}

/**
 * Extract a run number from a Norfolk H3 title like "Run #2139".
 * Exported for unit testing.
 */
export function extractRunNumber(title: string): number | undefined {
  const match = /Run\s*#\s*(\d+)/i.exec(title);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Parse a Norfolk H3 date string into YYYY-MM-DD format and extract time.
 *
 * Handles formats:
 *   "Sunday 29th March 2026, 11am"
 *   "Wednesday 6th May 2026, 7pm"
 *   "Wednesday 13 May 2026, 7pm"
 *   "Sunday 26th April 2026, 11amBelated St. Georges..." (merged text)
 *
 * Returns { date, startTime } or null if no date found.
 * Exported for unit testing.
 */
export function parseNorfolkDate(text: string): {
  date: string;
  startTime?: string;
} | null {
  // Lookbehind handles merged text like "11amBelated" where \b would fail
  const timeMatch = /(?<!\w)(\d{1,2}(?::\d{2})?\s*[ap]m)/i.exec(text);
  let startTime: string | undefined;
  if (timeMatch) {
    const rawTime = timeMatch[1].trim();
    // Normalize to "H:MM am/pm" format for parse12HourTime
    const normalized = rawTime
      .replace(/(\d{1,2})([ap]m)/i, "$1:00 $2")
      .replace(/(\d{1,2}:\d{2})([ap]m)/i, "$1 $2");
    startTime = parse12HourTime(normalized);
  }

  const date = chronoParseDate(text, "en-GB");
  if (!date) return null;

  return { date, startTime };
}

/**
 * Parse the content text of a Norfolk H3 post into structured fields.
 *
 * The content is a series of paragraphs (already converted to lines):
 *   Line 0: date+time, possibly with merged notes
 *   "Venue:" label followed by multi-line address
 *   "Hare(s):" label followed by names
 *   Various notes (parking, special events, etc.)
 *
 * Exported for unit testing.
 */
export function parseNorfolkRunBlock(text: string): ParsedNorfolkRun | null {
  if (!text.trim()) return null;

  const result: ParsedNorfolkRun = {};

  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const firstLine = lines[0];
  const dateResult = parseNorfolkDate(firstLine);
  if (!dateResult) return null;

  result.date = dateResult.date;
  result.startTime = dateResult.startTime;

  const fullText = lines.join("\n");

  // Match Venue: followed by content up to next known label or end
  const venueMatch = fullText.match(
    /Venue:\s*([\s\S]*?)(?=\n\s*(?:Hare\(s\):|Please\s+park|Contact)|\s*$)/i,
  );
  if (venueMatch) {
    const venueText = venueMatch[1]
      .replace(/\n/g, ", ")
      .replace(/,\s*,/g, ",")
      .replace(/,\s*$/, "")
      .replace(/^\s*,\s*/, "")
      .trim();

    const venue = stripPlaceholder(venueText);
    if (venue) {
      result.location = venue;

      const postcode = extractUkPostcode(venue);
      if (postcode) {
        result.locationUrl = googleMapsSearchUrl(postcode);
      }
    }
  }

  const haresMatch = fullText.match(/Hare\(s\):\s*(.*?)(?:\n|$)/i);
  if (haresMatch) {
    const haresText = haresMatch[1].trim();
    // "It could be you?" is a Norfolk-specific volunteer prompt, not a real hare name
    if (!/^It could be you\??$/i.test(haresText)) {
      result.hares = stripPlaceholder(haresText);
    }
  }

  // Collect notes by subtracting known blocks from the text
  let remainingText = lines.slice(1).join("\n");
  if (venueMatch) remainingText = remainingText.replace(venueMatch[0], "");
  if (haresMatch) remainingText = remainingText.replace(haresMatch[0], "");

  const noteLines = remainingText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Please\s+park/i.test(l) && !/^Contact\s+/i.test(l))
    .filter((l) => l.length > 3);

  // Check if the first line has merged notes after the time
  const mergedNotes = firstLine
    .replace(
      /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4},?\s*\d{1,2}(?::\d{2})?\s*[ap]m/i,
      "",
    )
    .trim();
  if (mergedNotes && mergedNotes.length > 3) {
    noteLines.unshift(mergedNotes);
  }

  if (noteLines.length > 0) {
    result.notes = noteLines.join(". ").replace(/\.\s*\./g, ".");
  }

  return result;
}

/**
 * Convert WordPress post content HTML to clean text with line breaks.
 * Converts <br> and </p> to newlines, strips tags, decodes entities.
 * Differs from shared stripHtmlTags() — preserves newlines only for <br>/<p>
 * (not all block elements) to maintain labeled-field boundaries.
 * Exported for unit testing.
 */
export function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/(strong|em|b|i|a|span)>/gi, "</$1> ");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  text = text
    .split("\n")
    .map((line) =>
      line
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");

  return text;
}

export class NorfolkH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://norfolkh3.co.uk/trails/";
    return this.fetchViaProxy(sourceUrl, options);
  }

  private async tryFetchWithUrlVariants(
    baseUrl: string,
    errorDetails: ErrorDetails,
  ): Promise<{ html: string; fetchUrl: string } | null> {
    const requestHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "max-age=0",
      "Sec-Ch-Ua":
        '"Chromium";v="124", "Not(A:Brand";v="24", "Google Chrome";v="124"',
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
        const response = await safeFetch(candidateUrl, {
          headers: requestHeaders,
          useResidentialProxy: USE_RESIDENTIAL_PROXY,
        });
        if (response.ok) {
          const html = await response.text();
          return { html, fetchUrl: candidateUrl };
        }
        const message = `HTTP ${response.status}: ${response.statusText}`;
        (errorDetails.fetch ??= []).push({
          url: candidateUrl,
          status: response.status,
          message,
        });

        if (response.status !== 403 && response.status !== 404) {
          return null;
        }
      } catch (err) {
        const message = `Fetch failed: ${err}`;
        (errorDetails.fetch ??= []).push({ url: candidateUrl, message });
      }
    }
    return null;
  }

  private async fetchViaProxy(
    baseUrl: string,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const fetchStart = Date.now();
    const fetchResult = await this.tryFetchWithUrlVariants(
      baseUrl,
      errorDetails,
    );

    if (!fetchResult) {
      const last = errorDetails.fetch?.[errorDetails.fetch.length - 1];
      const fallbackMessage = last?.message ?? "Fetch failed";
      return {
        events: [],
        errors: [fallbackMessage],
        errorDetails,
        diagnosticContext: { fetchMethod: "residential-proxy" },
      };
    }

    const { html, fetchUrl } = fetchResult;
    const fetchDurationMs = Date.now() - fetchStart;
    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 90);
    let primaryPostCount = 0;

    try {
      let posts = $(".wp-block-post-template > li").toArray();
      primaryPostCount = posts.length;

      // Fallback selectors in case the theme changes
      if (posts.length === 0) {
        posts = $("article.post, .wp-block-post").toArray();
      }
      if (posts.length === 0) {
        posts = $(".entry-content").toArray();
      }

      for (const el of posts) {
        const post = $(el);

        const titleEl = post
          .find(".wp-block-post-title, h3, h2")
          .first();
        const titleText = decodeEntities(titleEl.text().trim());
        const runNumber = extractRunNumber(titleText);

        const contentEl = post
          .find(".wp-block-post-content, .entry-content, .post-content")
          .first();

        if (!contentEl.length) continue;

        const contentHtml = contentEl.html() ?? "";
        const contentText = htmlToText(contentHtml);

        const parsed = parseNorfolkRunBlock(contentText);
        if (!parsed || !parsed.date) continue;

        if (runNumber) parsed.runNumber = runNumber;

        const eventDate = new Date(parsed.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) continue;

        const title = parsed.runNumber
          ? `${KENNEL_TAG} #${parsed.runNumber}`
          : KENNEL_TAG;

        events.push({
          date: parsed.date,
          kennelTags: [KENNEL_TAG],
          runNumber: parsed.runNumber,
          title,
          hares: parsed.hares,
          location: parsed.location,
          locationUrl: parsed.locationUrl,
          startTime: parsed.startTime,
          sourceUrl: fetchUrl,
          description: parsed.notes || undefined,
        });
      }
    } catch (err) {
      errors.push(`Parse error: ${err}`);
      (errorDetails.parse ??= []).push({
        row: 0,
        section: "trails",
        error: String(err),
        rawText: $("body").text().slice(0, 2000),
      });
    }

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "residential-proxy",
        postsFound: primaryPostCount,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
