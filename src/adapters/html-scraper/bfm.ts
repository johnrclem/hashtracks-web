import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { MONTHS, parse12HourTime, googleMapsSearchUrl } from "../utils";

const mapsUrl = googleMapsSearchUrl;

/**
 * Parse a BFM-style date string into YYYY-MM-DD.
 * Accepts: "2/12", "Thursday, 2/12", "Feb 19th", "March 5th"
 */
export function parseBfmDate(text: string, referenceYear: number): string | null {
  // Try M/D format: "2/12" or "Thursday, 2/12"
  const mdMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (mdMatch) {
    const month = parseInt(mdMatch[1], 10);
    const day = parseInt(mdMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try "Feb 19th", "March 5th", "8/8/2026"
  const fullMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (fullMatch) {
    const month = parseInt(fullMatch[1], 10);
    const day = parseInt(fullMatch[2], 10);
    const year = parseInt(fullMatch[3], 10);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Try month name format: "Feb 19th", "March 5"
  const monthNameMatch = text.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (monthNameMatch) {
    const monthNum = MONTHS[monthNameMatch[1].toLowerCase()];
    if (monthNum) {
      const day = parseInt(monthNameMatch[2], 10);
      return `${referenceYear}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
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

  const trailMatch = bodyText.match(/Trail\s*#(\d+)\s*:?\s*(.+?)(?:\n|$)/i);
  if (!trailMatch) {
    errors.push("No current trail found on page");
    parseErrors.push({ row: 0, section: "current_trail", error: "No current trail found on page", rawText: bodyText.slice(0, 2000), partialData: { kennelTag: "BFM" } });
    return { events, errors, parseErrors };
  }

  const runNumber = parseInt(trailMatch[1], 10);
  const trailName = trailMatch[2].trim();
  const fieldStop = /(?=(?:When|Where|Bring|Hares?|The Fun Part):|\n)/i;

  const whenMatch = bodyText.match(new RegExp(`When:\\s*(.+?)(?=${fieldStop.source}|$)`, "i"));
  const whereMatch = bodyText.match(new RegExp(`Where:\\s*(.+?)(?=${fieldStop.source}|$)`, "i"));
  const hareMatch = bodyText.match(/Hares?:\s*(.+?)(?=(?:When|Where|Bring|The Fun Part):|\n|$)/i);

  let dateStr: string | null = null;
  let startTime: string | undefined;

  if (whenMatch) {
    const whenText = whenMatch[1].trim();
    dateStr = parseBfmDate(whenText, currentYear);
    startTime = parseTime(whenText);
  }

  if (!dateStr) {
    errors.push("Could not parse date from current trail");
    parseErrors.push({ row: 0, section: "current_trail", field: "date", error: "Could not parse date from current trail", rawText: bodyText.slice(0, 2000), partialData: { kennelTag: "BFM" } });
    return { events, errors, parseErrors };
  }

  const location = whereMatch ? whereMatch[1].trim() : undefined;
  const hares = hareMatch ? hareMatch[1].trim() : undefined;

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
  const upcomingSection = bodyText.match(/Upcoming\s+Ha(?:re|sh)s?[:\s]*([\s\S]*?)(?:Special\s+Events|Mayor|$)/i);
  if (!upcomingSection) return events;

  const lines = upcomingSection[1].split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const lineMatch = line.match(/^(.+?)\s*[–—-]\s*(.+)$/);
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
    const specialRes = await fetch(specialUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!specialRes.ok) return { events, errors, fetchErrors };

    const specialHtml = await specialRes.text();
    const $special = cheerio.load(specialHtml);
    const specialText = $special("body").text();

    const datePattern = /(\d{4})\s*Date:\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s*)(\w+\s+\d{1,2})(?:st|nd|rd|th)?/gi;
    let dateLineMatch;
    while ((dateLineMatch = datePattern.exec(specialText)) !== null) {
      const year = parseInt(dateLineMatch[1], 10);
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

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;

    let html: string;
    try {
      const response = await fetch(baseUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [{ url: baseUrl, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }

    structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);
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
    events.push(...upcomingEvents);

    // Phase 3: Special events
    const specialResult = await scrapeSpecialEvents(baseUrl);
    events.push(...specialResult.events);
    errors.push(...specialResult.errors);
    if (specialResult.fetchErrors && specialResult.fetchErrors.length > 0) {
      errorDetails.fetch = [...(errorDetails.fetch ?? []), ...specialResult.fetchErrors];
    }

    const hasErrorDetails = (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0;
    const upcomingHaresCount = events.filter(e => !e.runNumber).length;

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
