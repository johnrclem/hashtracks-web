/**
 * St. Louis Hash House Harriers (STLH3) Substack Scraper
 *
 * Fetches event posts from stlh3.com, which is a Substack publication.
 *
 * Listing endpoint: /api/v1/archive?sort=new&limit=50
 * Detail endpoint: /api/v1/posts/{slug}
 *
 * Post structure:
 *   - title: "Upcumming Hash: Sunday Mar 29th 2026" -> parse date with chrono-node
 *   - subtitle: "Meet @ 5PM" -> parse start time
 *   - body_html (detail only): contains Google Maps links with venue
 *
 * Location is extracted from Google Maps URLs:
 *   google.com/maps/dir//VenueName+Address/@lat,lng
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { applyDateWindow, chronoParseDate } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";

/** Shape of a post from the Substack archive API listing */
interface SubstackArchivePost {
  title: string;
  subtitle: string | null;
  slug: string;
  post_date: string;
  canonical_url: string;
  body_html?: string | null;
}

/** Shape of a post detail from the Substack posts API */
interface SubstackPostDetail {
  title: string;
  subtitle: string | null;
  slug: string;
  body_html: string | null;
  canonical_url: string;
}

/**
 * Parse a start time from a subtitle string.
 * Formats: "Meet @ 5PM", "Meet @ 2pm", "Meet @ 11AM", "2:00 PM"
 * Returns "HH:MM" or "17:00" as default.
 */
export function parseSubtitleTime(subtitle?: string | null): string {
  if (!subtitle) return "17:00";

  const match = /(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(subtitle);
  if (!match) return "17:00";

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] || "00";
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Extract location from Google Maps URLs in body HTML.
 *
 * Pattern: google.com/maps/dir//VenueName+Address/@lat,lng
 * The part after /dir// and before /@ is the venue name/address (URL-encoded with +).
 *
 * Also matches: google.com/maps/place/VenueName+Address/
 */
export function extractLocationFromMapsUrl(
  bodyHtml: string,
): string | undefined {
  const $ = cheerio.load(bodyHtml);

  // Find Google Maps links
  const mapsLinks = $('a[href*="google.com/maps"]');
  if (!mapsLinks.length) return undefined;

  const href = mapsLinks.first().attr("href") ?? "";

  // Pattern 1: /maps/dir//VenueName+Address/@lat,lng
  const dirMatch = /\/maps\/dir\/\/([^/@]+)/i.exec(href);
  if (dirMatch) {
    return decodeURIComponent(dirMatch[1].replace(/\+/g, " ")).trim();
  }

  // Pattern 2: /maps/place/VenueName+Address/
  const placeMatch = /\/maps\/place\/([^/@]+)/i.exec(href);
  if (placeMatch) {
    return decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
  }

  // Fallback: link text
  const linkText = mapsLinks.first().text().trim();
  return linkText && linkText.length > 3 ? linkText : undefined;
}

/**
 * Parse a date from a Substack post title.
 * Format: "Upcumming Hash: Sunday Mar 29th 2026"
 * The date part is after the colon.
 */
export function parseTitleDate(title: string): string | null {
  // Try parsing after colon first (e.g., "Upcumming Hash: Sunday Mar 29th 2026")
  const colonIdx = title.indexOf(":");
  if (colonIdx !== -1) {
    const afterColon = title.slice(colonIdx + 1).trim();
    const date = chronoParseDate(afterColon, "en-US", undefined, {
      forwardDate: true,
    });
    if (date) return date;
  }

  // Fallback: parse entire title
  return chronoParseDate(title, "en-US", undefined, { forwardDate: true });
}

/**
 * STL H3 Substack Scraper
 *
 * Fetches the Substack archive listing, then fetches detail pages for each
 * post to get body_html with Google Maps links for location extraction.
 */
export class StlH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = (source.url || "https://www.stlh3.com").replace(
      /\/+$/,
      "",
    );
    // Honor source.scrapeDays via options.days (default 365)
    const days = options?.days ?? source.scrapeDays ?? 365;
    const archiveUrl = `${baseUrl}/api/v1/archive?sort=new&limit=50`;
    const fetchStart = Date.now();

    // Fetch archive listing
    let archivePosts: SubstackArchivePost[];
    try {
      const response = await safeFetch(archiveUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "HashTracks/1.0 (event aggregator; +https://hashtracks.com)",
        },
      });
      if (!response.ok) {
        const message = `Substack archive HTTP ${response.status}: ${response.statusText}`;
        return {
          events: [],
          errors: [message],
          errorDetails: {
            fetch: [{ url: archiveUrl, status: response.status, message }],
          },
        };
      }
      archivePosts = (await response.json()) as SubstackArchivePost[];
    } catch (err) {
      const message = `Substack archive fetch failed: ${err}`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: archiveUrl, message }] },
      };
    }

    if (!Array.isArray(archivePosts)) {
      return {
        events: [],
        errors: ["Substack archive returned non-array response"],
      };
    }

    // Filter to "Upcumming Hash" posts (event announcements)
    const eventPosts = archivePosts.filter((p) =>
      /upcumming|hash/i.test(p.title),
    );

    const events: RawEventData[] = [];
    const errors: string[] = [];
    let detailsFetched = 0;

    for (const post of eventPosts) {
      try {
        const date = parseTitleDate(post.title);
        if (!date) continue;

        const startTime = parseSubtitleTime(post.subtitle);

        // Fetch detail page for body_html (location extraction)
        let location: string | undefined;
        let bodyHtml: string | null = post.body_html ?? null;

        if (!bodyHtml) {
          try {
            const detailUrl = `${baseUrl}/api/v1/posts/${post.slug}`;
            const detailResponse = await safeFetch(detailUrl, {
              headers: {
                Accept: "application/json",
                "User-Agent":
                  "HashTracks/1.0 (event aggregator; +https://hashtracks.com)",
              },
            });
            if (detailResponse.ok) {
              const detail =
                (await detailResponse.json()) as SubstackPostDetail;
              bodyHtml = detail.body_html;
              detailsFetched++;
            }
          } catch {
            // Detail fetch failed — continue without location
          }
        }

        if (bodyHtml) {
          location = extractLocationFromMapsUrl(bodyHtml);
        }

        events.push({
          date,
          kennelTag: "stlh3",
          title: post.title,
          location,
          startTime,
          sourceUrl: post.canonical_url || `${baseUrl}/p/${post.slug}`,
        });
      } catch (err) {
        errors.push(`Error processing post "${post.slug}": ${err}`);
      }
    }

    // Generate structure hash from concatenated titles
    const structureInput = eventPosts
      .map((p) => p.title)
      .join("\n");
    const structureHash = generateStructureHash(structureInput);

    return applyDateWindow({
      events,
      errors,
      structureHash,
      diagnosticContext: {
        fetchMethod: "substack-api",
        archivePostsFound: archivePosts.length,
        eventPostsFiltered: eventPosts.length,
        detailsFetched,
        fetchDurationMs: Date.now() - fetchStart,
      },
    }, days);
  }
}
