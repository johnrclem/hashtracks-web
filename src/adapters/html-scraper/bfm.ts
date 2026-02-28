import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, parse12HourTime, googleMapsSearchUrl, fetchHTMLPage } from "../utils";
import { safeFetch } from "../safe-fetch";

const mapsUrl = googleMapsSearchUrl;

/** Precompiled terminators for BFM field extraction (avoids dynamic RegExp). */
const BFM_FIELD_TERMINATORS: RegExp[] = [
  /When:/i, /Where:/i, /Bring:/i, /Hares?:/i, /The Fun Part:/i,
];

/**
 * Extract a labeled field value from BFM body text.
 * Finds the label pattern and returns text up to the next known label or newline.
 * Uses precompiled RegExp literals only (no dynamic construction).
 */
function extractBfmField(bodyText: string, labelPattern: RegExp): string | null {
  const labelMatch = labelPattern.exec(bodyText);
  if (!labelMatch) return null;

  const valueStart = (labelMatch.index ?? 0) + labelMatch[0].length;
  const remaining = bodyText.slice(valueStart);

  // Find earliest terminator: newline or next known field label
  let endIdx = remaining.indexOf("\n");
  if (endIdx === -1) endIdx = remaining.length;

  for (const terminator of BFM_FIELD_TERMINATORS) {
    const fieldIdx = remaining.search(terminator);
    if (fieldIdx >= 0 && fieldIdx < endIdx) {
      endIdx = fieldIdx;
    }
  }

  const value = remaining.slice(0, endIdx).trim();
  return value || null;
}

/**
 * Parse a BFM-style date string into YYYY-MM-DD using chrono-node.
 * Handles: "2/12", "Thursday, 2/12", "8/8/2026", "Feb 19th", "March 5th"
 */
export function parseBfmDate(text: string, referenceYear: number): string | null {
  const ref = new Date(Date.UTC(referenceYear, 0, 1));
  return chronoParseDate(text, "en-US", ref);
}

/**
 * Parse time from BFM format: "7:00 PM gather" → "19:00"
 */
const parseTime = parse12HourTime;

/**
 * BFM Website Scraper
 *
 * Scrapes benfranklinmob.com for current trail details and upcoming hares.
 * The site is WordPress with Gutenberg blocks — content is structured as
 * headings + paragraphs with "When:", "Where:", "Hare:" labels.
 */
/** Scrape the current trail details from the main page body text. */
function scrapeCurrentTrail(
  bodyText: string,
  $: cheerio.CheerioAPI,
  currentYear: number,
  baseUrl: string,
): { events: RawEventData[]; errors: string[]; parseErrors: ErrorDetails["parse"] } {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const parseErrors: ErrorDetails["parse"] = [];

  const trailMatch = /Trail\s*#(\d+)\s*:?\s*([^\n]+?)(?:\n|$)/i.exec(bodyText);
  if (!trailMatch) {
    errors.push("No current trail found on page");
    parseErrors.push({ row: 0, section: "current_trail", error: "No current trail found on page", rawText: bodyText.slice(0, 2000), partialData: { kennelTag: "BFM" } });
    return { events, errors, parseErrors };
  }

  const runNumber = Number.parseInt(trailMatch[1], 10);
  const trailName = trailMatch[2].trim();
  const whenText = extractBfmField(bodyText, /When:\s*/i);
  const whereText = extractBfmField(bodyText, /Where:\s*/i);
  const hareText = extractBfmField(bodyText, /Hares?:\s*/i);

  let dateStr: string | null = null;
  let startTime: string | undefined;

  if (whenText) {
    dateStr = parseBfmDate(whenText, currentYear);
    startTime = parseTime(whenText);
  }

  if (!dateStr) {
    errors.push("Could not parse date from current trail");
    parseErrors.push({ row: 0, section: "current_trail", field: "date", error: "Could not parse date from current trail", rawText: bodyText.slice(0, 2000), partialData: { kennelTag: "BFM" } });
    return { events, errors, parseErrors };
  }

  const location = whereText ?? undefined;
  const hares = hareText ?? undefined;

  let locationUrl: string | undefined;
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    if (/maps\./i.test(href) || /google\.\w+\/maps/i.test(href)) {
      locationUrl = href;
      return false;
    }
  });
  if (!locationUrl && location) {
    locationUrl = mapsUrl(location);
  }

  events.push({
    date: dateStr,
    kennelTag: "BFM",
    runNumber,
    title: trailName,
    hares,
    location,
    locationUrl,
    startTime,
    sourceUrl: baseUrl,
  });

  return { events, errors, parseErrors };
}

/** Scrape upcoming hares list from the main page body text. */
function scrapeUpcomingHares(
  bodyText: string,
  currentYear: number,
  baseUrl: string,
): RawEventData[] {
  const events: RawEventData[] = [];
  const headerMatch = /Upcoming\s+Ha(?:re|sh)s?[:\s]*/i.exec(bodyText);
  if (!headerMatch) return events;
  const sectionStart = headerMatch.index + headerMatch[0].length;
  const specialIdx = bodyText.slice(sectionStart).search(/Special\s+Events|Mayor/i);
  const sectionText = specialIdx >= 0
    ? bodyText.slice(sectionStart, sectionStart + specialIdx)
    : bodyText.slice(sectionStart);

  const lines = sectionText.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const lineMatch = /^([^–—-]+?)\s*[–—-]\s*(.+)$/.exec(line);
    if (!lineMatch) continue;

    const datePart = lineMatch[1].trim();
    const harePart = lineMatch[2].trim();
    if (/could be you/i.test(harePart)) continue;

    const dateStr = parseBfmDate(datePart, currentYear);
    if (!dateStr) continue;

    events.push({
      date: dateStr,
      kennelTag: "BFM",
      title: undefined,
      hares: harePart,
      sourceUrl: baseUrl,
    });
  }

  return events;
}

/** Scrape special events page for future events with dates. */
async function scrapeSpecialEvents(
  baseUrl: string,
): Promise<{ events: RawEventData[]; errors: string[]; fetchErrors: ErrorDetails["fetch"] }> {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const fetchErrors: ErrorDetails["fetch"] = [];

  const specialUrl = baseUrl.replace(/\/$/, "") + "/bfm-special-events/";
  try {
    const specialRes = await safeFetch(specialUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!specialRes.ok) return { events, errors, fetchErrors };

    const specialHtml = await specialRes.text();
    const $special = cheerio.load(specialHtml);
    const specialText = $special("body").text();

    const datePattern = /(\d{4})\s*Date:\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s*)?(\w+\s+\d{1,2})(?:st|nd|rd|th)?/gi;
    let dateLineMatch;
    while ((dateLineMatch = datePattern.exec(specialText)) !== null) {
      const year = Number.parseInt(dateLineMatch[1], 10);
      const monthDay = dateLineMatch[2];
      const dateStr = parseBfmDate(monthDay, year);
      if (!dateStr) continue;

      const beforeMatch = specialText.substring(Math.max(0, dateLineMatch.index - 200), dateLineMatch.index);
      const lines = beforeMatch.split("\n").map((l) => l.trim()).filter(Boolean);
      const title = lines.length > 0 ? lines[lines.length - 1] : undefined;

      events.push({
        date: dateStr,
        kennelTag: "BFM",
        title,
        sourceUrl: specialUrl,
      });
    }
  } catch (err) {
    const message = `Special events fetch failed: ${err}`;
    errors.push(message);
    fetchErrors.push({ url: specialUrl, message: String(err) });
  }

  return { events, errors, fetchErrors };
}

export class BFMAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://benfranklinmob.com";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;
    const { $, structureHash } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const currentYear = new Date().getFullYear();
    const bodyText = $("body").text();

    // Phase 1: Current trail
    const currentTrail = scrapeCurrentTrail(bodyText, $, currentYear, baseUrl);
    events.push(...currentTrail.events);
    errors.push(...currentTrail.errors);
    if (currentTrail.parseErrors && currentTrail.parseErrors.length > 0) {
      errorDetails.parse = [...(errorDetails.parse ?? []), ...currentTrail.parseErrors];
    }

    // Phase 2: Upcoming hares
    const upcomingEvents = scrapeUpcomingHares(bodyText, currentYear, baseUrl);
    const upcomingHaresCount = upcomingEvents.filter(e => !e.runNumber).length;
    events.push(...upcomingEvents);

    // Phase 3: Special events
    const specialResult = await scrapeSpecialEvents(baseUrl);
    events.push(...specialResult.events);
    errors.push(...specialResult.errors);
    if (specialResult.fetchErrors && specialResult.fetchErrors.length > 0) {
      errorDetails.fetch = [...(errorDetails.fetch ?? []), ...specialResult.fetchErrors];
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        currentTrailFound: events.some(e => e.runNumber !== undefined),
        upcomingHaresCount,
      },
    };
  }
}
