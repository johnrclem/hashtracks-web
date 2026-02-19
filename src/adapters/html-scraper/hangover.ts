import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Parse a Hangover Hash post title into trail number and name.
 * Format: "#214 - The Hungover Hearts Trail"
 */
export function parseHangoverTitle(title: string): {
  runNumber?: number;
  trailName?: string;
} | null {
  const match = title.match(/^#(\d+)\s*[-–—]\s*(.+)$/);
  if (match) {
    return {
      runNumber: parseInt(match[1], 10),
      trailName: match[2].trim(),
    };
  }
  return null;
}

/**
 * Parse a date string like "Sunday, February 15th, 2026" into YYYY-MM-DD.
 * Also handles: "Saturday, April 12, 2025", "Sunday, May 4th, 2025"
 */
export function parseHangoverDate(text: string): string | null {
  const match = text.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (!match) return null;

  const monthNum = MONTHS[match[1].toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse time from format like "10:00am" or "10:15am" into HH:MM.
 */
function parseTime(text: string): string | undefined {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return undefined;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Parse labeled fields from a Hangover Hash post body.
 *
 * Expected fields (bold labels):
 *   Date: Sunday, February 15th, 2026
 *   Hare(s): Just Rebekah and Grinding Nemo
 *   Trail Start: Leesburg Town Hall Garage, 10 Loudoun St SW, Leesburg, VA 20175
 *   Hash Cash: $7.00 US
 *   Trail Type: A to A
 *   Hares Away / Pack Away: 10:00am / 10:15am
 *   Eagle: ~7.69 miles, Turkey: ~5.2 miles, Penguin: ~3.8 miles
 *   Prelube: Restaurant name
 *   On-After / On On Brunch: Restaurant name + address
 */
export function parseHangoverBody(text: string): {
  date?: string;
  hares?: string;
  location?: string;
  hashCash?: string;
  startTime?: string;
  trailType?: string;
  onAfter?: string;
  distances?: string;
} {
  // Date
  const dateMatch = text.match(/(?:^|\n)\s*(?:Date|When)\s*:\s*(.+?)(?=\n|$)/im);
  const date = dateMatch ? parseHangoverDate(dateMatch[1].trim()) : undefined;

  // Hares
  const hareMatch = text.match(/Hare(?:\(s\)|s)?\s*:\s*(.+?)(?=\n|$)/im);

  // Location (Trail Start)
  const locationMatch = text.match(/(?:Trail Start|Start|Location|Where)\s*:\s*(.+?)(?=\n|$)/im);

  // Hash Cash
  const cashMatch = text.match(/Hash Cash\s*:\s*(.+?)(?=\n|$)/im);

  // Time (Pack Away or Hares Away)
  const timeMatch = text.match(/(?:Pack Away|Hares? Away)\s*(?:at|:)\s*(\d{1,2}:\d{2}\s*(?:am|pm))/im);
  const startTime = timeMatch ? parseTime(timeMatch[1]) : undefined;

  // Trail Type
  const trailTypeMatch = text.match(/Trail Type\s*:\s*(.+?)(?=\n|$)/im);

  // On-After
  const onAfterMatch = text.match(/(?:On[- ]?After|On On|On On Brunch)\s*:\s*(.+?)(?=\n|$)/im);

  // Distances (multiple levels: Eagle, Turkey, Penguin)
  const distanceParts: string[] = [];
  const eagleMatch = text.match(/Eagle\s*(?:~|:)?\s*([\d.]+)\s*mi/i);
  const turkeyMatch = text.match(/Turkey\s*(?:~|:)?\s*([\d.]+)\s*mi/i);
  const penguinMatch = text.match(/Penguin\s*(?:~|:)?\s*([\d.]+)\s*mi/i);
  if (eagleMatch) distanceParts.push(`Eagle: ~${eagleMatch[1]} mi`);
  if (turkeyMatch) distanceParts.push(`Turkey: ~${turkeyMatch[1]} mi`);
  if (penguinMatch) distanceParts.push(`Penguin: ~${penguinMatch[1]} mi`);

  return {
    date: date ?? undefined,
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    location: locationMatch ? locationMatch[1].trim() : undefined,
    hashCash: cashMatch ? cashMatch[1].trim() : undefined,
    startTime,
    trailType: trailTypeMatch ? trailTypeMatch[1].trim() : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
    distances: distanceParts.length > 0 ? distanceParts.join(", ") : undefined,
  };
}

/**
 * Hangover Hash (H4) DigitalPress Blog Scraper
 *
 * Scrapes hangoverhash.digitalpress.blog for trail announcements. This is a
 * Ghost CMS blog. Each post title has format "#NNN - Trail Name" and the body
 * contains structured fields for date, hares, location, hash cash, distances,
 * trail type, and on-after.
 */
export class HangoverAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://hangoverhash.digitalpress.blog/";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let html: string;
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
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

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // Ghost CMS uses article.gh-card for post cards on listing pages,
    // or article.gh-article for single post pages
    const articles = $("article.gh-card, article.post, .post-card, article").toArray();

    for (let i = 0; i < articles.length; i++) {
      const article = $(articles[i]);

      // Get the post title and link
      const titleEl = article.find("h2 a, h3 a, .gh-card-title, .post-card-title, .gh-article-title").first();
      let titleText = titleEl.text().trim();
      if (!titleText) {
        // Try h2/h3 directly
        titleText = article.find("h2, h3, h1").first().text().trim();
      }
      const postUrl = titleEl.attr("href") || article.find("a").first().attr("href") || baseUrl;

      if (!titleText) continue;

      // Parse the title
      const parsed = parseHangoverTitle(titleText);
      if (!parsed) continue;

      // Try to get body content from the article card excerpt or full content
      const bodyEl = article.find(".gh-content, .post-content, .gh-card-excerpt, .post-card-excerpt").first();
      const bodyText = bodyEl.text() || "";
      const bodyFields = parseHangoverBody(bodyText);

      // We need a date from the body, the Ghost published date, or we skip
      let eventDate = bodyFields.date;
      if (!eventDate) {
        // Try Ghost's datetime attribute
        const timeEl = article.find("time[datetime]").first();
        const datetime = timeEl.attr("datetime");
        if (datetime) {
          // ISO date from Ghost: "2026-02-10T..."
          const isoMatch = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
          if (isoMatch) eventDate = isoMatch[1];
        }
      }

      if (!eventDate) continue;

      // Build description
      const descParts: string[] = [];
      if (bodyFields.trailType) descParts.push(`Trail Type: ${bodyFields.trailType}`);
      if (bodyFields.distances) descParts.push(bodyFields.distances);
      if (bodyFields.hashCash) descParts.push(`Hash Cash: ${bodyFields.hashCash}`);
      if (bodyFields.onAfter) descParts.push(`On After: ${bodyFields.onAfter}`);

      // Generate location URL
      let locationUrl: string | undefined;
      if (bodyFields.location) {
        locationUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bodyFields.location)}`;
      }

      events.push({
        date: eventDate,
        kennelTag: "H4",
        runNumber: parsed.runNumber,
        title: parsed.trailName,
        hares: bodyFields.hares,
        location: bodyFields.location,
        locationUrl,
        startTime: bodyFields.startTime || "10:15", // H4 default: pack away at 10:15 AM
        sourceUrl: postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`,
        description: descParts.length > 0 ? descParts.join(" | ") : undefined,
      });
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        articlesFound: articles.length,
        eventsParsed: events.length,
      },
    };
  }
}
