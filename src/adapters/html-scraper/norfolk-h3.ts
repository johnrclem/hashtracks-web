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

// Stop labels for both Venue: and Hare(s): captures inside parseNorfolkRunBlock.
// "Afterwards" is the most common offender — Norfolk authors paste an on-after
// food/bar blurb between the address and the hares (#1257). The other labels
// are pre-existing notes/contact prompts. A blank line (paragraph break) is
// also a hard stop — htmlToText emits "\n\n" for </p>.
//
// Source-layout assumption (verified against current and historical Norfolk
// posts): each post wraps an entire section (Venue+address, Hare(s)+names,
// notes) in ONE <p> with <br> separators between lines. Distinct sections
// are separate <p> elements, so blank lines reliably bound them. If the
// Norfolk theme ever switches to per-line <p> elements (e.g. each address
// line in its own paragraph), the blank-line stop would truncate addresses
// at the first newline and this regex would need to drop the blank-line
// arm in favor of explicit-label-only stops.
const SECTION_STOP =
  /\n\s*(?:\n|Hare\(s\):|Venue:|Please\s+park|Contact\s|Afterwards\b|Wear\s|Bring\s|On\s+down\b|On-On\b)/i;
const VENUE_RE = new RegExp(
  String.raw`Venue:\s*([\s\S]*?)(?=${SECTION_STOP.source}|\s*$)`,
  "i",
);
const HARES_RE = new RegExp(
  String.raw`Hare\(s\):\s*([\s\S]*?)(?=${SECTION_STOP.source}|\s*$)`,
  "i",
);

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

  // Preserve blank lines (paragraph boundaries from htmlToText's </p>→"\n\n"
  // conversion) so multi-line Hare(s): blocks can be separated from trailing
  // notes paragraphs (#1257).
  const rawLines = text.split(/\n/).map((l) => l.trim());
  // Trim leading/trailing blanks but keep internal paragraph breaks.
  while (rawLines.length > 0 && rawLines[0] === "") rawLines.shift();
  while (rawLines.length > 0 && rawLines.at(-1) === "") rawLines.pop();
  if (rawLines.length === 0) return null;

  const firstLine = rawLines[0];
  const dateResult = parseNorfolkDate(firstLine);
  if (!dateResult) return null;

  result.date = dateResult.date;
  result.startTime = dateResult.startTime;

  const fullText = rawLines.join("\n");

  // Match Venue: followed by content up to next known label or end
  const venueMatch = VENUE_RE.exec(fullText);
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

  // Capture Hare(s): block as multi-line — Norfolk authors put each hare on
  // a separate line under one label (#1257 — "Tweedledum (Simon)" was being
  // dropped into notes/description because the regex only matched one line).
  const haresMatch = HARES_RE.exec(fullText);
  if (haresMatch) {
    const haresText = haresMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(", ")
      .trim();
    // "It could be you?" is a Norfolk-specific volunteer prompt, not a real hare name
    if (!/^It could be you\??$/i.test(haresText)) {
      result.hares = stripPlaceholder(haresText);
    }
  }

  // Collect notes by subtracting known blocks from the text. Use rawLines
  // (with blank-line paragraph markers) so venueMatch[0]/haresMatch[0] —
  // which contain those blank lines — can match.
  let remainingText = rawLines.slice(1).join("\n");
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
  // <br> + any surrounding whitespace (including the literal newline that
  // typically follows in source markup) collapses to a single \n. Without
  // consuming the trailing whitespace, "<br>\n" became "\n\n" and produced
  // spurious blank lines between consecutive address parts.
  text = text.replace(/<br\s*\/?>\s*/gi, "\n");
  // </p> + trailing whitespace becomes a paragraph break (\n\n). The single
  // intervening blank line is what parseNorfolkRunBlock uses as a section
  // stop so multi-line Hare(s): blocks don't swallow notes paragraphs (#1257).
  text = text.replace(/<\/p>\s*/gi, "\n\n");
  text = text.replace(/<\/(strong|em|b|i|a|span)>/gi, "</$1> ");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  // Trim each line; collapse runs of blank lines to at most one blank.
  return text
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
      const last = errorDetails.fetch?.at(-1);
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
