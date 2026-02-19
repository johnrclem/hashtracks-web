import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";

/**
 * Parse a DCH4 post title into structured fields.
 *
 * Standard format: "DCH4 Trail# 2299 - 2/14 @ 2pm"
 * Variations:
 *   "DCH4 Trail# 2298 - 2/7/26 @ 2pm"
 *   "DCH4 Trail# 2224 - 2/17 @ 2pm - SWILL TEAM SIX!!"
 *   "DCH4 Trail 1926: 10/15 10am MD Renaissance Festival"
 */
export function parseDch4Title(title: string, referenceYear: number): {
  runNumber?: number;
  date?: string;
  startTime?: string;
  theme?: string;
} | null {
  // Try standard format: "DCH4 Trail# NNNN - M/D[/YY] @ Npm"
  const standard = title.match(
    /DCH4\s+Trail\s*#?\s*(\d+)\s*[-–:]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[@]?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*[-–]\s*(.+))?/i
  );
  if (standard) {
    const runNumber = parseInt(standard[1], 10);
    const month = parseInt(standard[2], 10);
    const day = parseInt(standard[3], 10);
    let year = standard[4] ? parseInt(standard[4], 10) : referenceYear;
    if (year < 100) year += 2000;

    let hours = parseInt(standard[5], 10);
    const minutes = standard[6] || "00";
    const ampm = standard[7].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;

    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const startTime = `${String(hours).padStart(2, "0")}:${minutes}`;
    const theme = standard[8]?.trim() || undefined;

    return { runNumber, date, startTime, theme };
  }

  return null;
}

/**
 * Parse labeled fields from DCH4 post body text.
 * Fields are in semi-structured paragraph format with bold labels.
 */
export function parseDch4Body(text: string): {
  hares?: string;
  location?: string;
  hashCash?: string;
  onAfter?: string;
  runnerDistance?: string;
  walkerDistance?: string;
} {
  // Stop patterns require the label to be followed by colon to avoid matching inside words
  // (e.g., "Blonde" contains "on" which would false-match "On" without the colon anchor)
  const hareMatch = text.match(/Hares?\s*:\s*(.+?)(?=\n|(?:Start|Location|Cost|Hash Cash|On\s*-?\s*After|Trail|Dog|Stroller)\s*:|$)/i);
  const locationMatch = text.match(/(?:Start|Start Location|Location|Where)\s*:\s*(.+?)(?=\n|(?:Hare|Cost|Hash Cash|Trail|Dog|Stroller|On\s*-?\s*After)\s*:|$)/i);
  const costMatch = text.match(/(?:Hash Cash|Cost)\s*:\s*\$?(\d+)/i);
  const onAfterMatch = text.match(/On\s*-?\s*After\s*:\s*(.+?)(?=\n|$)/i);
  const runnerMatch = text.match(/Runners?\s*(?:~|about|less than|:)?\s*([\d.]+)\s*(?:mi(?:les?)?)/i);
  const walkerMatch = text.match(/Walkers?\s*(?:~|about|:)?\s*([\d.]+)\s*(?:mi(?:les?)?)/i);

  return {
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    location: locationMatch ? locationMatch[1].trim() : undefined,
    hashCash: costMatch ? `$${costMatch[1]}` : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
    runnerDistance: runnerMatch ? `${runnerMatch[1]} mi` : undefined,
    walkerDistance: walkerMatch ? `${walkerMatch[1]} mi` : undefined,
  };
}

/**
 * Generate a Google Maps search URL from a location string.
 */
function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * DCH4 WordPress Trail Posts Scraper
 *
 * Scrapes dch4.org for trail announcements. DCH4 is one of the most active
 * DC kennels (2299+ trails). Each WordPress blog post contains trail number,
 * date, time, location, hares, distances, and more.
 */
export class DCH4Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://dch4.org/";

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
    const currentYear = new Date().getFullYear();

    // Find all article post entries
    const articles = $("article.post, article.type-post, article[class*='post-'], .hentry").toArray();

    for (let i = 0; i < articles.length; i++) {
      const article = $(articles[i]);

      // Get the post title
      const titleEl = article.find(".entry-title a, h2.entry-title a, h2 a, h1.entry-title a").first();
      const titleText = titleEl.text().trim() || article.find(".entry-title, h2").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      if (!titleText) continue;

      // Parse the title for structured data
      const parsed = parseDch4Title(titleText, currentYear);
      if (!parsed || !parsed.date) continue;

      // Try to parse body content for additional fields
      const contentEl = article.find(".entry-content, .post-content").first();
      const bodyText = contentEl.text() || "";
      const bodyFields = parseDch4Body(bodyText);

      // Build location URL
      let locationUrl: string | undefined;
      if (bodyFields.location) {
        // Check for GPS coordinates
        const gpsMatch = bodyFields.location.match(/([-\d.]+),\s*([-\d.]+)/);
        if (gpsMatch) {
          locationUrl = `https://www.google.com/maps/search/?api=1&query=${gpsMatch[1]},${gpsMatch[2]}`;
        } else {
          locationUrl = mapsUrl(bodyFields.location);
        }
      }

      // Build description from available data
      const descParts: string[] = [];
      if (parsed.theme) descParts.push(parsed.theme);
      if (bodyFields.runnerDistance) descParts.push(`Runners: ${bodyFields.runnerDistance}`);
      if (bodyFields.walkerDistance) descParts.push(`Walkers: ${bodyFields.walkerDistance}`);
      if (bodyFields.hashCash) descParts.push(`Hash Cash: ${bodyFields.hashCash}`);
      if (bodyFields.onAfter) descParts.push(`On After: ${bodyFields.onAfter}`);

      events.push({
        date: parsed.date,
        kennelTag: "DCH4",
        runNumber: parsed.runNumber,
        title: parsed.theme || `DCH4 Trail #${parsed.runNumber}`,
        hares: bodyFields.hares,
        location: bodyFields.location,
        locationUrl,
        startTime: parsed.startTime,
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
