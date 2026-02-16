import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";

/**
 * Generate a Google Maps search URL from a location string.
 */
function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * Parse a Philly H3 date string into YYYY-MM-DD.
 * Format: "Sat, Feb 14, 2026" or "Sat, February 14, 2026"
 */
function parsePhillyDate(text: string): string | null {
  const MONTHS: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };

  // "Sat, Feb 14, 2026" or "February 14, 2026"
  const match = text.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (!match) return null;

  const monthNum = MONTHS[match[1].toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse time from Philly format: "3:00 PM Hash Standard Time" → "15:00"
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
 * Philly H3 Website Scraper
 *
 * Scrapes hashphilly.com/nexthash/ for the next trail details.
 * The site shows only one event at a time with label:value text fields:
 * Trail Number, Date, Time, Location, Hash Cash.
 */
export class HashPhillyAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://hashphilly.com/nexthash/";

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
    const bodyText = $("body").text();

    // Extract fields using label:value pattern
    const trailNumberMatch = bodyText.match(/Trail\s*Number:\s*(\d+)/i);
    const dateMatch = bodyText.match(/Date:\s*(.+?)(?:\n|$)/i);
    const timeMatch = bodyText.match(/Time:\s*(.+?)(?:\n|$)/i);
    const locationMatch = bodyText.match(/Location:\s*(.+?)(?:\n|$)/i);

    if (!dateMatch) {
      errorDetails.parse = [{ row: 0, section: "main", field: "date", error: "No date found on page" }];
      return { events: [], errors: ["No date found on page"], structureHash, errorDetails };
    }

    const dateStr = parsePhillyDate(dateMatch[1].trim());
    if (!dateStr) {
      const message = `Could not parse date: "${dateMatch[1].trim()}"`;
      errorDetails.parse = [{ row: 0, section: "main", field: "date", error: message, partialData: { kennelTag: "Philly H3" } }];
      return { events: [], errors: [message], structureHash, errorDetails };
    }

    const runNumber = trailNumberMatch
      ? parseInt(trailNumberMatch[1], 10)
      : undefined;
    const startTime = timeMatch ? parseTime(timeMatch[1].trim()) : undefined;
    const location = locationMatch ? locationMatch[1].trim() : undefined;

    const fieldsFound: string[] = [];
    if (trailNumberMatch) fieldsFound.push("trailNumber");
    if (dateMatch) fieldsFound.push("date");
    if (timeMatch) fieldsFound.push("time");
    if (locationMatch) fieldsFound.push("location");

    events.push({
      date: dateStr,
      kennelTag: "Philly H3",
      runNumber,
      location,
      locationUrl: location ? mapsUrl(location) : undefined,
      startTime,
      sourceUrl: baseUrl,
    });

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: { fieldsFound },
    };
  }
}
