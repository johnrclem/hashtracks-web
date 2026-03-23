import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { safeFetch } from "../safe-fetch";
import { stripHtmlTags, decodeEntities } from "../utils";

const BASE_URL = "https://shith3.com";

/** Listing endpoint response item */
export interface ListingItem {
  title: string;
  start: string; // "2026-03-03T19:00:00"
  end?: string;
  type: string; // "t" = trail, others filtered out
  lookup_id: string;
}

/** Detail endpoint response */
export interface DetailItem {
  TRAIL?: string;
  TITLE?: string;
  LOCATION?: string;
  hashdate?: string;
  hares?: string[];
  TIDBIT?: string;
  ONONON?: string;
  NOTES?: string;
  ADDRESS?: string;
  MAPLINK?: string;
}

/**
 * Parse a listing title like "Trail 1196: Peek a Boob" into run number and trail name.
 * Handles "Trail NNN: Name" and "Trail NNN - Name" patterns.
 */
export function parseListingTitle(title: string): { runNumber?: number; trailName?: string } {
  const match = title.match(/^Trail\s+(\d+)\s*[:–—-]\s*(.+)$/i);
  if (match) {
    return {
      runNumber: parseInt(match[1], 10),
      trailName: match[2].trim(),
    };
  }
  return { trailName: title.trim() };
}

/**
 * Extract "HH:MM" start time from an ISO-like datetime string.
 * "2026-03-03T19:00:00" → "19:00"
 */
export function extractStartTime(isoLike: string): string | undefined {
  const match = isoLike.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : undefined;
}

/**
 * Extract "YYYY-MM-DD" date from an ISO-like datetime string.
 * "2026-03-03T19:00:00" → "2026-03-03"
 */
export function extractDate(isoLike: string): string | undefined {
  const match = isoLike.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

/** Strip HTML tags and decode entities from a field value. */
function cleanHtml(text: string): string {
  return stripHtmlTags(decodeEntities(text), "\n").trim();
}

/**
 * Build a combined description from detail fields.
 * Includes TIDBIT, parsed distances from NOTES, and on-after venue.
 */
export function buildDescription(detail: DetailItem): string | undefined {
  const parts: string[] = [];

  if (detail.TIDBIT) parts.push(cleanHtml(detail.TIDBIT));

  if (detail.NOTES) {
    const distances = parseDistances(detail.NOTES);
    if (distances) parts.push(distances);
  }

  if (detail.ONONON) parts.push(`On-After: ${cleanHtml(detail.ONONON)}`);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * Parse distance lines from NOTES field.
 * Handles formats like "R = 4.5 mi\nW = 2.7 mi" or "Runners: 4 mi / Walkers: 2 mi"
 */
function parseDistances(notes: string): string | undefined {
  const distanceParts: string[] = [];

  // "R = 4.5 mi" pattern
  const rMatch = notes.match(/R\s*=\s*([\d.]+)\s*mi/i);
  if (rMatch) distanceParts.push(`Runners: ${rMatch[1]} mi`);

  const wMatch = notes.match(/W\s*=\s*([\d.]+)\s*mi/i);
  if (wMatch) distanceParts.push(`Walkers: ${wMatch[1]} mi`);

  return distanceParts.length > 0 ? distanceParts.join(", ") : undefined;
}

/**
 * Build a full RawEventData from a detail API response + listing item.
 * Detail fields take precedence; listing provides start time.
 */
export function buildEventFromDetail(detail: DetailItem, listing: ListingItem): RawEventData {
  const date = detail.hashdate || extractDate(listing.start);
  if (!date) throw new Error(`No date for event ${listing.lookup_id}`);

  const runNumber = detail.TRAIL ? parseInt(detail.TRAIL, 10) : undefined;
  const hares = detail.hares && detail.hares.length > 0
    ? detail.hares.join(", ")
    : undefined;
  const location = detail.LOCATION || detail.ADDRESS || undefined;

  let locationUrl: string | undefined;
  if (detail.MAPLINK && detail.MAPLINK.trim()) {
    locationUrl = detail.MAPLINK.trim();
  } else if (location) {
    locationUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
  }

  return {
    date,
    kennelTag: "shith3",
    runNumber: runNumber && !isNaN(runNumber) ? runNumber : undefined,
    title: decodeEntities(detail.TITLE || "") || parseListingTitle(listing.title).trailName,
    hares,
    location,
    locationUrl,
    startTime: extractStartTime(listing.start),
    description: buildDescription(detail),
    sourceUrl: `${BASE_URL}/events.php`,
  };
}

/**
 * Build a fallback RawEventData from just the listing item (when detail fetch fails).
 */
export function buildEventFromListing(listing: ListingItem): RawEventData | null {
  const date = extractDate(listing.start);
  if (!date) return null;

  const parsed = parseListingTitle(listing.title);

  return {
    date,
    kennelTag: "shith3",
    runNumber: parsed.runNumber,
    title: parsed.trailName,
    startTime: extractStartTime(listing.start),
    sourceUrl: `${BASE_URL}/events.php`,
  };
}

/**
 * SHITH3 adapter — scrapes shith3.com PHP REST API.
 *
 * Strategy:
 * 1. Fetch event listing (JSON array) for a date window
 * 2. Filter to trail events (type === "t")
 * 3. Fetch detail for each trail event (rich data: hares, location, description)
 * 4. Fall back to listing-only data when detail fetch fails
 */
export class SHITH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();

    const days = options?.days || 90;
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days);

    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    // Step 1: Fetch listing
    const listingUrl = `${BASE_URL}/php/get-events.php?start=${startStr}&end=${endStr}`;
    let listings: ListingItem[];
    try {
      const res = await safeFetch(listingUrl, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const msg = `Listing fetch failed: HTTP ${res.status}`;
        errorDetails.fetch = [{ url: listingUrl, status: res.status, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }
      listings = (await res.json()) as ListingItem[];
    } catch (err) {
      const msg = `Listing fetch error: ${err}`;
      errorDetails.fetch = [{ url: listingUrl, message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    // Step 2: Filter to trail events only
    const trails = listings.filter((item) => item.type === "t");

    // Step 3: Fetch detail for each trail
    let detailSuccesses = 0;
    let detailFailures = 0;

    /** Push a listing-only fallback event when detail fetch fails. */
    const pushFallback = (item: ListingItem) => {
      const fallback = buildEventFromListing(item);
      if (fallback) events.push(fallback);
    };

    for (const listing of trails) {
      const detailUrl = `${BASE_URL}/php/get-event.php?id=${listing.lookup_id}&type=t`;
      try {
        const detailRes = await safeFetch(detailUrl, {
          headers: { Accept: "application/json" },
        });

        if (!detailRes.ok) {
          detailFailures++;
          errors.push(`Detail fetch failed for ${listing.lookup_id}: HTTP ${detailRes.status}`);
          errorDetails.fetch = [
            ...(errorDetails.fetch ?? []),
            { url: detailUrl, status: detailRes.status, message: `HTTP ${detailRes.status}` },
          ];
          pushFallback(listing);
          continue;
        }

        const detail = (await detailRes.json()) as DetailItem;
        const event = buildEventFromDetail(detail, listing);
        events.push(event);
        detailSuccesses++;
      } catch (err) {
        detailFailures++;
        const msg = `Detail error for ${listing.lookup_id}: ${err}`;
        errors.push(msg);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: 0, section: listing.lookup_id, error: String(err) },
        ];
        pushFallback(listing);
      }
    }

    const fetchDurationMs = Date.now() - fetchStart;

    return {
      events,
      errors,
      errorDetails: errors.length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "php-api",
        listingCount: listings.length,
        trailCount: trails.length,
        detailSuccesses,
        detailFailures,
        eventsProduced: events.length,
        fetchDurationMs,
      },
    };
  }
}
