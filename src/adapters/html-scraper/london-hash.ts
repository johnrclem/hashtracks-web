import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, isPlaceholder, parse12HourTime, fetchHTMLPage } from "../utils";

/** Max detail pages to fetch per scrape (only first N events). */
const MAX_DETAIL_FETCHES = 3;

/** Boilerplate text that concatenates with hare names in .text() output. */
const LH3_HARE_BOILERPLATE_RE = /\s*(?:Unlike hashes|open in Google Maps|There is no need).*$/i;

/** London center coords used as placeholder on TBA pages. */
const LONDON_CENTER_LAT = 51.508;
const LONDON_CENTER_LNG = -0.128;
const COORD_THRESHOLD = 0.01; // ~1km

/** Represents a parsed run block from the London Hash run list page. */
export interface RunBlock {
  runNumber: number;
  runId: string; // The nextrun.php ID parameter
  text: string; // Raw text content of the block
}

/**
 * Split the London Hash run list page into individual run blocks.
 * Each block is anchored by a <a href="nextrun.php?run=XXXX"> link.
 */
export function parseRunBlocks(html: string): RunBlock[] {
  const $ = cheerio.load(html);
  const blocks: RunBlock[] = [];

  // Strategy 1: Structured layout with .runListDetails containers (actual website)
  const containers = $(".runListDetails");
  if (containers.length > 0) {
    containers.each((_i, el) => {
      const $block = $(el);
      const $link = $block.find('a[href*="nextrun.php"]');
      if (!$link.length) return;

      const href = $link.attr("href") || "";
      const runIdMatch = href.match(/run=(\d+)/);
      if (!runIdMatch) return;

      const runId = runIdMatch[1];
      const runNumber = parseInt($link.text().trim(), 10);
      if (isNaN(runNumber)) return;

      // Replace <br> with newlines so date/time don't concatenate
      $block.find("br").replaceWith("\n");
      // Insert newlines at table-cell boundaries so "Who" row value doesn't
      // run into the "What Else" row label in .text() output. Closes #609.
      $block.find("td, th").before("\n");
      // Insert space after inline elements to prevent "Name1Name2" concatenation
      $block.find("span, a, strong, em, b, i").after(" ");
      const text = $block.text().trim();

      blocks.push({ runNumber, runId, text });
    });
    return blocks;
  }

  // Strategy 2: Flat text layout (fallback for simple HTML)
  const runLinks = $('a[href*="nextrun.php"]');
  runLinks.each((i, el) => {
    const $link = $(el);
    const href = $link.attr("href") || "";
    const runIdMatch = href.match(/run=(\d+)/);
    if (!runIdMatch) return;

    const runId = runIdMatch[1];
    const linkText = $link.text().trim();
    const runNumber = parseInt(linkText, 10);
    if (isNaN(runNumber)) return;

    let text = "";
    const $parent = $link.closest("p, li, section, body");
    if ($parent.length) {
      const fullText = $parent.text();
      const linkPos = fullText.indexOf(linkText);
      if (linkPos >= 0) {
        const nextLink = runLinks.eq(i + 1);
        if (nextLink.length) {
          const nextText = nextLink.text().trim();
          const nextPos = fullText.indexOf(nextText, linkPos + linkText.length);
          text = nextPos > linkPos
            ? fullText.substring(linkPos, nextPos).trim()
            : fullText.substring(linkPos).trim();
        } else {
          text = fullText.substring(linkPos).trim();
        }
      }
    }

    if (!text) {
      text = $link.parent().text().trim();
    }

    blocks.push({ runNumber, runId, text });
  });

  return blocks;
}

/**
 * Parse a date from a London Hash run block using chrono-node.
 * Handles: "Saturday 21st of February 2026", "21/02/2026", "Monday 22nd June", etc.
 */
export function parseDateFromBlock(text: string, referenceYear?: number): string | null {
  const refDate = referenceYear
    ? new Date(Date.UTC(referenceYear, 0, 1)) // Jan 1 of reference year
    : undefined;
  return chronoParseDate(text, "en-GB", refDate);
}

/**
 * Parse hares from a London Hash run block.
 * Formats:
 *   "Hared by Tuna Melt and Opee"
 *   "Hare: John Smith"
 *   "Hare required"
 */
export function parseHaresFromBlock(text: string): string | null {
  // "Hared by Name and Name" or "Hared by Name"
  const haredByMatch = text.match(/Hared?\s+by\s+(.+?)(?:\n|$|\*)/i);
  if (haredByMatch) {
    let hares = haredByMatch[1].trim();
    // Skip placeholder text
    if (/required|volunteer|tba|tbd|tbc/i.test(hares)) return null;
    // Truncate at known boilerplate text that concatenates with hare names in .text() output
    hares = hares.replace(LH3_HARE_BOILERPLATE_RE, "").trim();
    // Normalize multiple consecutive spaces (from inline element spacing) to single space
    hares = hares.replace(/\s{2,}/g, " ");
    return hares || null;
  }

  // "Hare: Name"
  const hareColonMatch = text.match(/Hare:\s*(.+?)(?:\n|$|\*)/i);
  if (hareColonMatch) {
    let hares = hareColonMatch[1].trim();
    if (/required|volunteer|tba|tbd|tbc/i.test(hares)) return null;
    hares = hares.replace(LH3_HARE_BOILERPLATE_RE, "").trim();
    hares = hares.replace(/\s{2,}/g, " ");
    return hares || null;
  }

  return null;
}

/**
 * Parse location/starting point from a London Hash run block.
 * Formats:
 *   "Follow the P trail from Sydenham station to The Dolphin"
 *   "Start: Victoria Park" (if present)
 */
export function parseLocationFromBlock(text: string): { location?: string; station?: string } {
  // "Follow the P trail from STATION to PUB"
  const pTrailMatch = text.match(
    /(?:Follow|P\s*trail)\s+(?:the\s+P\s+trail\s+)?from\s+(.+?)\s+(?:station\s+)?to\s+(.+?)(?:\n|$|\*)/i,
  );
  if (pTrailMatch) {
    const station = pTrailMatch[1].trim();
    let loc = pTrailMatch[2].trim();
    // Filter placeholder or announcement text (e.g., "to be announced")
    if (isPlaceholder(loc) || /\bannounce/i.test(loc)) {
      return { station };
    }
    // Strip trailing description text that bleeds into location
    loc = loc.replace(/\s+(?:followed by|then on to|and then|details|more info|see)\b.*/i, "").trim();
    return { station, location: loc };
  }

  // "Start: LOCATION" pattern
  const startMatch = text.match(/Start:\s*(.+?)(?:\n|$|\*)/i);
  if (startMatch) {
    const loc = startMatch[1].trim();
    if (isPlaceholder(loc)) return {};
    return { location: loc };
  }

  return {};
}

/**
 * Parse time from a London Hash run block.
 * "12 Noon for 12:30" → "12:00"
 * "7pm for 7:15" → "19:00"
 * "7:00 PM" → "19:00"
 */
export function parseTimeFromBlock(text: string): string | null {
  // "12 Noon" or "Noon"
  if (/\b(?:12\s+)?noon\b/i.test(text)) {
    return "12:00";
  }

  // "Xpm for X:XX" or "X:XX PM" — handle optional minutes (e.g., "7pm")
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    // If minutes are present, delegate to shared parser
    if (timeMatch[2]) {
      return parse12HourTime(text) ?? null;
    }
    // Handle bare "7pm" (no minutes) — not handled by parse12HourTime
    let hours = parseInt(timeMatch[1], 10);
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, "0")}:00`;
  }

  return null;
}

/** Data extracted from a London Hash detail page (nextrun.php?run=XXXX). */
export interface LH3DetailPageData {
  runNumber?: number;
  latitude?: number;
  longitude?: number;
  location?: string;
  station?: string;
  hares?: string;
  distance?: string;
  onOn?: string;
  locationUrl?: string;
  sourceUrl: string;
}

/**
 * Check if coordinates are the default London center placeholder.
 * Placeholder pages use ~(51.508, -0.128) which is the London center.
 */
function isDefaultLondonCoords(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - LONDON_CENTER_LAT) < COORD_THRESHOLD &&
    Math.abs(lng - LONDON_CENTER_LNG) < COORD_THRESHOLD
  );
}

/**
 * Parse a London Hash detail page (nextrun.php) into structured data.
 * Accepts a cheerio instance (from fetchHTMLPage) plus raw HTML for JS regex extraction.
 * Returns null for placeholder/TBA pages.
 */
export function parseLH3DetailPage($: cheerio.CheerioAPI, html: string, detailUrl: string): LH3DetailPageData | null {
  const fullText = $("body").text();

  // Detect placeholder pages: "to be Announced" in headings or "details to be announced" in body
  if (/next run to be announced/i.test(fullText) && !/follow the p trail/i.test(fullText)) {
    return null;
  }

  const result: LH3DetailPageData = { sourceUrl: detailUrl };

  // Extract Google Maps link: href="http://maps.google.com/?q=LAT,LNG"
  const mapsLink = $('a[href*="maps.google.com/?q="]').attr("href");
  if (mapsLink) {
    const qMatch = mapsLink.match(/\?q=(-?[\d.]+),(-?[\d.]+)/);
    if (qMatch) {
      const lat = parseFloat(qMatch[1]);
      const lng = parseFloat(qMatch[2]);
      if (!isNaN(lat) && !isNaN(lng) && !isDefaultLondonCoords(lat, lng)) {
        result.locationUrl = mapsLink;
        result.latitude = lat;
        result.longitude = lng;
      }
    }
  }

  // Also try JS coords: { lat: X, lng: Y } (center or marker positions)
  if (result.latitude == null) {
    for (const m of html.matchAll(/\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g)) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (!isNaN(lat) && !isNaN(lng) && !isDefaultLondonCoords(lat, lng)) {
        result.latitude = lat;
        result.longitude = lng;
        break;
      }
    }
  }

  // "What" → run number: "London hash number XXXX"
  const runNumMatch = fullText.match(/(?:London\s+hash\s+number|hash\s+number)\s+(\d+)/i);
  if (runNumMatch) {
    result.runNumber = parseInt(runNumMatch[1], 10);
  }

  // "Where" → reuse existing location parser
  const { location, station } = parseLocationFromBlock(fullText);
  if (location) result.location = location;
  if (station) result.station = station;

  // "Who" → reuse existing hare parser
  const hares = parseHaresFromBlock(fullText);
  if (hares) result.hares = hares;

  // "How Far" → distance text
  const distMatch = fullText.match(/(\d+\s*(?:meters?|metres?)\s+from\s+.+?)(?:\n|$)/i);
  if (distMatch) {
    result.distance = distMatch[1].trim();
  }

  // On-On / On Inn: body text or JS marker title
  const onOnMatch = fullText.match(/On\s+Inn\s+to\s+(.+?)(?:\n|$)/i);
  if (onOnMatch) {
    result.onOn = onOnMatch[1].trim();
  } else {
    const markerOnOn = html.match(/title:\s*"On\s+Inn\s+to\s+(.+?)"/i);
    if (markerOnOn) {
      result.onOn = markerOnOn[1].trim();
    }
  }

  return result;
}

/**
 * Merge detail-page data into a run-list event.
 * Detail fields override run-list fields where present.
 */
export function mergeLH3DetailIntoEvent(event: RawEventData, detail: LH3DetailPageData): RawEventData {
  const merged: RawEventData = { ...event };

  if (detail.latitude != null && detail.longitude != null) {
    merged.latitude = detail.latitude;
    merged.longitude = detail.longitude;
  }
  if (detail.locationUrl) {
    merged.locationUrl = detail.locationUrl;
  }
  if (detail.location) {
    merged.location = detail.location;
  }
  if (detail.hares) {
    merged.hares = detail.hares;
  }

  // Enrich description with detail page info, preserving base station if detail lacks one
  const descParts: string[] = [];
  const station = detail.station ?? event.description?.match(/Nearest station: (.+?)(?:\.|$)/)?.[1];
  if (station) descParts.push(`Nearest station: ${station}`);
  if (detail.onOn) descParts.push(`On-On: ${detail.onOn}`);
  if (detail.distance) descParts.push(`Distance: ${detail.distance}`);
  if (descParts.length > 0) {
    merged.description = descParts.join(". ");
  }

  merged.sourceUrl = detail.sourceUrl;

  return merged;
}

/**
 * London Hash House Harriers (LH3) HTML Scraper
 *
 * Scrapes londonhash.org/runlist.php for upcoming runs, then enriches
 * the first few events with detail page data (coordinates, On-On, distance).
 * Follows the OCH3 two-phase pattern: run list + detail page enrichment.
 */
export class LondonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.londonhash.org/runlist.php";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const currentYear = new Date().getFullYear();
    const blocks = parseRunBlocks(html);
    const baseUrlObj = new URL(baseUrl);
    const detailBase = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      try {
        const date = parseDateFromBlock(block.text, currentYear);
        if (!date) {
          (errorDetails.parse ??= []).push(
            { row: i, section: "runlist", field: "date", error: `No date in block for run #${block.runNumber}`, rawText: block.text.slice(0, 2000) },
          );
          continue;
        }

        const hares = parseHaresFromBlock(block.text);
        const { location, station } = parseLocationFromBlock(block.text);
        const startTime = parseTimeFromBlock(block.text) ?? "12:00";

        // Build description with station info
        const descParts: string[] = [];
        if (station) descParts.push(`Nearest station: ${station}`);
        const description = descParts.length > 0 ? descParts.join(". ") : undefined;

        const sourceUrl = `${detailBase}/nextrun.php?run=${block.runId}`;

        events.push({
          date,
          kennelTags: ["lh3"],
          runNumber: block.runNumber,
          title: `London Hash Run #${block.runNumber}`,
          hares: hares ?? undefined,
          location: location ?? undefined,
          startTime,
          sourceUrl,
          description,
        });
      } catch (err) {
        errors.push(`Error parsing run #${block.runNumber}: ${err}`);
        (errorDetails.parse ??= []).push(
          { row: i, section: "runlist", error: String(err), rawText: block.text.slice(0, 2000) },
        );
      }
    }

    // Phase 2: Fetch detail pages for first N events
    let detailPagesFetched = 0;
    let detailPagesEnriched = 0;
    const detailBlocks = blocks.slice(0, MAX_DETAIL_FETCHES);

    if (detailBlocks.length > 0) {
      const detailResults = await Promise.allSettled(
        detailBlocks.map(async (block) => {
          const detailUrl = `${detailBase}/nextrun.php?run=${block.runId}`;
          const resp = await fetchHTMLPage(detailUrl);
          return { block, resp, detailUrl };
        }),
      );

      for (const settled of detailResults) {
        if (settled.status !== "fulfilled") continue;
        const { block, resp, detailUrl } = settled.value;
        detailPagesFetched++;

        if (!resp.ok) {
          errors.push(`Detail page fetch failed for run #${block.runNumber}`);
          continue;
        }

        const detail = parseLH3DetailPage(resp.$, resp.html, detailUrl);
        if (!detail) continue;

        // Verify run number matches before merging
        if (detail.runNumber != null && detail.runNumber !== block.runNumber) {
          errors.push(`Detail page run number mismatch for run #${block.runNumber}: got ${detail.runNumber}`);
          continue;
        }

        const matchIdx = events.findIndex((e) => e.runNumber === block.runNumber);
        if (matchIdx >= 0) {
          events[matchIdx] = mergeLH3DetailIntoEvent(events[matchIdx], detail);
          detailPagesEnriched++;
        }
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blocks.length,
        eventsParsed: events.length,
        fetchDurationMs,
        detailPagesFetched,
        detailPagesEnriched,
      },
    };
  }
}
