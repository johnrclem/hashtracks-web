import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, parse12HourTime, HARE_BOILERPLATE_RE } from "../utils";
import { extractCoordsFromMapsUrl } from "@/lib/geo";

/**
 * Parse a date string like "March 15" into "YYYY-MM-DD" with year inference.
 * Dates without years use current year, bumped to next year if the date is in the past.
 */
export function parseIH3Date(text: string): string | null {
  const match = /(\w+)\s+(\d{1,2})/.exec(text);
  if (!match) return null;

  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  const monthStr = match[1].toLowerCase();
  const month = monthNames[monthStr];
  if (!month) return null;

  const day = parseInt(match[2], 10);
  if (day < 1 || day > 31) return null;

  // Year inference: use current year, bump to next if date is >30 days in the past
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);

  // If the date is more than 30 days in the past, assume next year
  const daysDiff = (now.getTime() - candidate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > 30) {
    year++;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single event <p> block from the IH3 hare-line page.
 *
 * Expected HTML structure:
 *   <p>
 *     <strong>#1119: March 15</strong><br>
 *     <strong>Hares:</strong> Flesh Flaps &amp; Spike<br>
 *     <span style="font-weight: 600;">Where</span>: <a href="maps-url">Flat Rock</a><br>
 *     <span style="font-weight: 600;">When:</span> 2:00 pm<br>
 *     <span style="font-weight: 600;">Cost:</span> $5 (first timers free)<br>
 *     <span style="font-weight: 600;">Details</span>: <a href="...">touch me</a>
 *   </p>
 */
export function parseIH3Block(
  $block: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): RawEventData | null {
  const blockHtml = $.html($block);
  const blockText = $block.text();

  // Extract trail number and date from the first <strong>
  const headerMatch = /#(\d+)\s*:\s*(.+)/i.exec($block.find("strong").first().text());
  if (!headerMatch) return null;

  const runNumber = parseInt(headerMatch[1], 10);
  const dateText = headerMatch[2].trim();
  const date = parseIH3Date(dateText);
  if (!date) return null;

  // Extract hares
  let hares: string | undefined;
  const haresMatch = /Hares?\s*:\s*(.+?)(?:<br|$)/i.exec(blockHtml);
  if (haresMatch) {
    // Get text content, strip HTML tags
    const haresHtml = haresMatch[1];
    const hares$ = cheerio.load(`<div>${haresHtml}</div>`);
    const haresText = hares$("div").text().trim();
    if (haresText && !/^tbd|tba$/i.test(haresText)) {
      hares = haresText.replace(HARE_BOILERPLATE_RE, "").trim();
      if (!hares) hares = undefined;
    }
  }

  // Extract location — look for "Where" label
  let location: string | undefined;
  let locationUrl: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;

  const whereMatch = /Where\s*:?\s*/i.exec(blockText);
  if (whereMatch) {
    // Find the text after "Where:" up to the next label or end
    const afterWhere = blockText.slice(whereMatch.index + whereMatch[0].length);
    const locationText = afterWhere.split(/\n|When\s*:|Cost\s*:|Details\s*:|Hares?\s*:/i)[0]?.trim();
    if (locationText) {
      location = locationText;
    }
  }

  // Extract links in a single pass: Google Maps URLs and detail page URLs
  let detailUrl: string | undefined;
  $block.find("a").each((_i, a) => {
    const href = $(a).attr("href") || "";
    if (href.includes("google") && (href.includes("maps") || href.includes("map"))) {
      locationUrl = href;
      const coords = extractCoordsFromMapsUrl(href);
      if (coords) {
        latitude = coords.lat;
        longitude = coords.lng;
      }
      if (!location) {
        const linkText = $(a).text().trim();
        if (linkText) location = linkText;
      }
    } else if (href.includes("ithacah3.org")) {
      detailUrl = href;
    }
  });

  // Extract time — look for "When" label
  let startTime: string | undefined;
  const whenMatch = /When\s*:?\s*(.+?)(?:\n|Cost|Details|$)/i.exec(blockText);
  if (whenMatch) {
    startTime = parse12HourTime(whenMatch[1]);
  }

  return {
    date,
    kennelTags: ["ih3"],
    runNumber: !isNaN(runNumber) ? runNumber : undefined,
    title: `IH3 #${runNumber}`,
    hares,
    location,
    locationUrl,
    latitude,
    longitude,
    startTime,
    sourceUrl: detailUrl || sourceUrl,
  };
}

/**
 * Ithaca Hash House Harriers (IH3) Hare-Line Scraper
 *
 * Scrapes ithacah3.org/hare-line/ — a WordPress page with events listed
 * in <p> blocks. Each block contains trail number, date, hares, location
 * (often with Google Maps links), and time.
 *
 * Uses HTTP (not HTTPS) because the site's SSL certificate is expired.
 */
export class IthacaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "http://ithacah3.org/hare-line/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let blockIndex = 0;

    // Find the main content area
    const contentArea = $(".entry-content, .post-content, article, .page-content").first();
    const container = contentArea.length > 0 ? contentArea : $("body");

    // Find <p> blocks that contain trail info (start with <strong>#NNN)
    container.find("p").each((_i, el) => {
      const $p = $(el);
      const text = $p.text().trim();

      // Only process blocks that look like event entries
      if (!/#\d+/.test(text)) return;

      try {
        const event = parseIH3Block($p, $, url);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing block ${blockIndex}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: blockIndex,
          error: String(err),
          rawText: text.slice(0, 2000),
        });
      }
      blockIndex++;
    });

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blockIndex,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
