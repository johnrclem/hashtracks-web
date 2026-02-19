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
 * Parse a date string like "Saturday, March 14, 2026" into YYYY-MM-DD.
 * Also handles: "March 14, 2026", "March 14th, 2026"
 */
export function parseOfh3Date(text: string): string | null {
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
 * Parse labeled fields from an OFH3 post body.
 *
 * Expected fields (bold labels followed by text):
 *   Hares: Name & Name
 *   When: Saturday, March 14, 2026
 *   Cost: $5, virgins free
 *   Where: Blue Heron Elementary School
 *   Trail Type: A-A
 *   Distances: 3ish
 *   Shiggy rating (1-10): 5
 *   On-After: Venue Name
 */
export function parseOfh3Body(text: string): {
  date?: string;
  hares?: string;
  cost?: string;
  location?: string;
  trailType?: string;
  distances?: string;
  shiggyRating?: string;
  onAfter?: string;
} {
  // Use label-based extraction, stopping at the next known label or newline
  const labels = "(?:Hares?|When|Time|Cost|Where|Trail Type|Distances?|Shiggy|On[- ]?After)";
  const stopPattern = `(?=${labels}|\\n|$)`;

  const whenMatch = text.match(new RegExp(`When:\\s*(.+?)${stopPattern}`, "i"));
  const hareMatch = text.match(new RegExp(`Hares?:\\s*(.+?)${stopPattern}`, "i"));
  const costMatch = text.match(new RegExp(`Cost:\\s*(.+?)${stopPattern}`, "i"));
  const whereMatch = text.match(new RegExp(`Where:\\s*(.+?)${stopPattern}`, "i"));
  const trailTypeMatch = text.match(new RegExp(`Trail Type:\\s*(.+?)${stopPattern}`, "i"));
  const distancesMatch = text.match(new RegExp(`Distances?:\\s*(.+?)${stopPattern}`, "i"));
  const shiggyMatch = text.match(/Shiggy\s*(?:rating)?\s*(?:\(1-10\))?\s*:\s*(.+?)(?=(?:Hares?|When|Cost|Where|Trail Type|Distances?|On[- ]?After)|\n|$)/i);
  const onAfterMatch = text.match(new RegExp(`On[- ]?After:\\s*(.+?)${stopPattern}`, "i"));

  const date = whenMatch ? parseOfh3Date(whenMatch[1].trim()) : undefined;

  return {
    date: date ?? undefined,
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    cost: costMatch ? costMatch[1].trim() : undefined,
    location: whereMatch ? whereMatch[1].trim() : undefined,
    trailType: trailTypeMatch ? trailTypeMatch[1].trim() : undefined,
    distances: distancesMatch ? distancesMatch[1].trim() : undefined,
    shiggyRating: shiggyMatch ? shiggyMatch[1].trim() : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
  };
}

/**
 * OFH3 Blogspot Trail Posts Scraper
 *
 * Scrapes ofh3.com (Blogger/Blogspot) for trail announcements. Each blog post
 * is one trail (monthly cadence). Posts have themed titles and structured
 * labeled fields in the body for hares, date, cost, location, trail type,
 * distances, shiggy rating, and on-after.
 */
export class OFH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.ofh3.com/";

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

    // Blogger uses .post-outer or .post for each blog post
    const posts = $(".post-outer, .post, .blog-post").toArray();

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      // Get the post title
      const titleEl = post.find(".post-title a, .entry-title a, h3.post-title a").first();
      const titleText = titleEl.text().trim() || post.find(".post-title, .entry-title, h3").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      // Get the post body
      const bodyEl = post.find(".post-body, .entry-content").first();
      const bodyText = bodyEl.text() || "";

      // Parse the body for structured fields
      const bodyFields = parseOfh3Body(bodyText);

      // We need at least a date to create an event
      if (!bodyFields.date) {
        if (bodyText.trim().length > 0) {
          errors.push(`Could not parse date from post: ${titleText || "(untitled)"}`);
          errorDetails.parse = [...(errorDetails.parse ?? []), {
            row: i, section: "post", field: "date",
            error: `No date found in post: ${titleText || "(untitled)"}`,
          }];
        }
        continue;
      }

      // Build description from trail details
      const descParts: string[] = [];
      if (bodyFields.trailType) descParts.push(`Trail Type: ${bodyFields.trailType}`);
      if (bodyFields.distances) descParts.push(`Distances: ${bodyFields.distances}`);
      if (bodyFields.shiggyRating) descParts.push(`Shiggy: ${bodyFields.shiggyRating}`);
      if (bodyFields.cost) descParts.push(`Cost: ${bodyFields.cost}`);
      if (bodyFields.onAfter) descParts.push(`On After: ${bodyFields.onAfter}`);

      // Generate location URL
      let locationUrl: string | undefined;
      if (bodyFields.location && bodyFields.location.toLowerCase() !== "tba") {
        locationUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bodyFields.location)}`;
      }

      events.push({
        date: bodyFields.date,
        kennelTag: "OFH3",
        title: titleText || undefined,
        hares: bodyFields.hares,
        location: bodyFields.location && bodyFields.location.toLowerCase() !== "tba" ? bodyFields.location : undefined,
        locationUrl,
        startTime: "11:00", // OFH3 standard: hares away at 11:00 AM
        sourceUrl: postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`,
        description: descParts.length > 0 ? descParts.join(" | ") : undefined,
      });
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        postsFound: posts.length,
        eventsParsed: events.length,
      },
    };
  }
}
