import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { MONTHS, extractUkPostcode } from "../utils";

/**
 * Parse ordinal date from City Hash title: "24th Feb 2026" → "2026-02-24"
 * Also handles: "1st March 2026", "2nd Jan 2026", "3rd April 2026"
 */
export function parseDateFromTitle(title: string): string | null {
  const match = title.match(
    /(\d{1,2})(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i,
  );
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthNum = MONTHS[match[2].toLowerCase()];
  const year = parseInt(match[3], 10);

  if (!monthNum || day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** @deprecated Use extractUkPostcode from ../utils instead */
export const extractPostcode = extractUkPostcode;

/**
 * Parse a single .ch-run card element into RawEventData.
 */
export function parseRunCard(
  $: cheerio.CheerioAPI,
  $card: Cheerio<AnyNode>,
  baseUrl: string,
): RawEventData | null {
  // Title: "City Hash R*n #1910 - 24th Feb 2026"
  const titleText = $card.find(".ch-run-title h5").text().trim();
  if (!titleText) return null;

  // Run number from #NNNN
  const runNumMatch = titleText.match(/#(\d+)/);
  const runNumber = runNumMatch ? parseInt(runNumMatch[1], 10) : undefined;

  // Date from title
  const date = parseDateFromTitle(titleText);
  if (!date) return null;

  // Location: pub + postcode from .ch-run-location link
  const locationLink = $card.find(".ch-run-location a");
  const locationText = locationLink.text().trim();
  const locationUrl = locationLink.attr("href") || undefined;

  // Extract pub name (everything before the postcode)
  const postcode = extractPostcode(locationText);
  const pubName = postcode
    ? locationText.replace(postcode, "").trim()
    : locationText;
  const location = pubName || locationText || undefined;

  // Station from .ch-run-ptransport
  const stationLink = $card.find(".ch-run-ptransport a");
  const station = stationLink.text().trim() || undefined;

  // Hares + extra info from .ch-run-description paragraphs
  let hares: string | undefined;
  const descParts: string[] = [];
  $card.find(".ch-run-description p").each((_i, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    const hareMatch = text.match(/^Hares?\s*[-–—]\s*(.+)/i);
    if (hareMatch) {
      hares = hareMatch[1].trim();
    } else if (!/^Pub\s*[-–—]/i.test(text) && !/^Station\s*[-–—]/i.test(text)) {
      // Skip "Pub -" and "Station -" (already captured above)
      descParts.push(text);
    }
  });

  // Build description with station info
  if (station) {
    descParts.unshift(`Nearest station: ${station}`);
  }
  if (postcode) {
    descParts.push(`Postcode: ${postcode}`);
  }
  const description = descParts.length > 0 ? descParts.join(". ") : undefined;

  // Build title: "City Hash Run #NNNN" or original theme from title
  const themePart = titleText.replace(/City Hash R\*?n\s*#\d+\s*[-–—]\s*/i, "").trim();
  const dateInTitle = themePart.match(/\d{1,2}(?:st|nd|rd|th)\s+\w+\s+\d{4}/i);
  const theme = dateInTitle
    ? themePart.replace(dateInTitle[0], "").replace(/^\s*[-–—]\s*/, "").trim()
    : themePart;
  const title = theme && theme !== titleText
    ? `City Hash Run #${runNumber} - ${theme}`
    : `City Hash Run #${runNumber}`;

  return {
    date,
    kennelTag: "CityH3",
    runNumber,
    title,
    hares,
    location,
    locationUrl,
    startTime: "19:00",
    sourceUrl: baseUrl,
    description,
  };
}

/**
 * City Hash (London) HTML Scraper
 *
 * Scrapes cityhash.org.uk for upcoming runs. The site uses Makesweat-powered
 * WordPress with .ch-run CSS classes for structured run cards.
 */
export class CityHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://cityhash.org.uk/";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;

    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          { url: baseUrl, status: response.status, message },
        ];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // Parse all .ch-run cards
    const cards = $(".ch-run");
    cards.each((i, el) => {
      try {
        const event = parseRunCard($, $(el), baseUrl);
        if (event) {
          events.push(event);
        } else {
          const titleText = $(el).find(".ch-run-title h5").text().trim();
          errors.push(`Could not parse run card ${i}: ${titleText}`);
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: "ch-run", field: "date", error: `Could not parse: ${titleText}`, rawText: $(el).text().trim().slice(0, 2000) },
          ];
        }
      } catch (err) {
        errors.push(`Error parsing card ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "ch-run", error: String(err), rawText: $(el).text().trim().slice(0, 2000) },
        ];
      }
    });

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        cardsFound: cards.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
