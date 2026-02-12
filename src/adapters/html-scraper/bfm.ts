import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";

/**
 * Generate a Google Maps search URL from a location string.
 */
function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * Parse a BFM-style date string into YYYY-MM-DD.
 * Accepts: "2/12", "Thursday, 2/12", "Feb 19th", "March 5th"
 */
function parseBfmDate(text: string, referenceYear: number): string | null {
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
  const MONTHS: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };
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
 * BFM Website Scraper
 *
 * Scrapes benfranklinmob.com for current trail details and upcoming hares.
 * The site is WordPress with Gutenberg blocks — content is structured as
 * headings + paragraphs with "When:", "Where:", "Hare:" labels.
 */
export class BFMAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://benfranklinmob.com";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    let structureHash: string | undefined;

    let html: string;
    try {
      const response = await fetch(baseUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (!response.ok) {
        return { events: [], errors: [`HTTP ${response.status}: ${response.statusText}`] };
      }
      html = await response.text();
    } catch (err) {
      return { events: [], errors: [`Fetch failed: ${err}`] };
    }

    structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);
    const now = new Date();
    const currentYear = now.getFullYear();

    // Extract the full text content for parsing
    const bodyText = $("body").text();

    // Parse current trail from "Trail #NNNN:" heading pattern
    const trailMatch = bodyText.match(/Trail\s*#(\d+)\s*:?\s*(.+?)(?:\n|$)/i);
    if (trailMatch) {
      const runNumber = parseInt(trailMatch[1], 10);
      const trailName = trailMatch[2].trim();

      // WordPress Gutenberg text runs together without newlines between fields.
      // Use lookahead to known labels as delimiters: When/Where/Bring/Hare/The Fun Part
      const fieldStop = /(?=(?:When|Where|Bring|Hares?|The Fun Part):|\n)/i;

      // Find "When:" field — stops at next label
      const whenMatch = bodyText.match(new RegExp(`When:\\s*(.+?)(?=${fieldStop.source}|$)`, "i"));
      // Find "Where:" field — stops at next label
      const whereMatch = bodyText.match(new RegExp(`Where:\\s*(.+?)(?=${fieldStop.source}|$)`, "i"));
      // Find "Hare:" or "Hares:" field — stops at next label or newline
      const hareMatch = bodyText.match(/Hares?:\s*(.+?)(?=(?:When|Where|Bring|The Fun Part):|\n|$)/i);

      let dateStr: string | null = null;
      let startTime: string | undefined;

      if (whenMatch) {
        const whenText = whenMatch[1].trim();
        dateStr = parseBfmDate(whenText, currentYear);
        startTime = parseTime(whenText);
      }

      if (dateStr) {
        const location = whereMatch ? whereMatch[1].trim() : undefined;
        const hares = hareMatch ? hareMatch[1].trim() : undefined;

        // Try to find a Google Maps link for the location
        let locationUrl: string | undefined;
        $("a[href]").each((_i, el) => {
          const href = $(el).attr("href") ?? "";
          if (/maps\./i.test(href) || /google\.\w+\/maps/i.test(href)) {
            locationUrl = href;
            return false; // break
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
      } else {
        errors.push("Could not parse date from current trail");
      }
    } else {
      errors.push("No current trail found on page");
    }

    // Parse upcoming hares list
    // Pattern: "Feb 19th – Name and Name" or "March 5th – Name"
    const upcomingSection = bodyText.match(/Upcoming\s+Ha(?:re|sh)s?[:\s]*([\s\S]*?)(?:Special\s+Events|Mayor|$)/i);
    if (upcomingSection) {
      const lines = upcomingSection[1].split("\n").filter((l) => l.trim());
      for (const line of lines) {
        // Match: "Feb 19th – Fly Me to the Poon and Cumdog Millionaire"
        const lineMatch = line.match(/^(.+?)\s*[–—-]\s*(.+)$/);
        if (!lineMatch) continue;

        const datePart = lineMatch[1].trim();
        const harePart = lineMatch[2].trim();

        // Skip placeholder entries
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
    }

    // Scrape special events page for future events with dates
    try {
      const specialUrl = baseUrl.replace(/\/$/, "") + "/bfm-special-events/";
      const specialRes = await fetch(specialUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (specialRes.ok) {
        const specialHtml = await specialRes.text();
        const $special = cheerio.load(specialHtml);
        const specialText = $special("body").text();

        // Format: "2026 Date: Saturday, August 8th" — year is in the label prefix
        const datePattern = /(\d{4})\s*Date:\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s*)(\w+\s+\d{1,2})(?:st|nd|rd|th)?/gi;
        let dateLineMatch;
        while ((dateLineMatch = datePattern.exec(specialText)) !== null) {
          const year = parseInt(dateLineMatch[1], 10);
          const monthDay = dateLineMatch[2]; // e.g. "August 8"
          const dateStr = parseBfmDate(monthDay, year);
          if (!dateStr) continue;

          // Title is in the text before the date line — find the last non-empty line
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
      }
    } catch (err) {
      errors.push(`Special events fetch failed: ${err}`);
    }

    return { events, errors, structureHash };
  }
}
