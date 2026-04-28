/**
 * Yoko-Yoko Hash House Harriers (Y2H3) Hareline Scraper
 *
 * Scrapes y2h3.net — a static HTML page with a `table#hareline` containing
 * single-cell rows. Each `<td>` has:
 * - `span.eventheader a` — event title + Facebook event URL
 * - `span.eventdate` — date/time string like "Friday, March 20, 2026 - 7:00 PM"
 * - Body text after image with `<br>` separators containing semi-structured
 *   fields: location (Where:/Location:), hare (Hare:/Hares:), fee (Fee:/Cost:),
 *   run number (Run #X / #X)
 *
 * Monthly kennel based in the Yokohama/Yokosuka area, Japan.
 */

import * as cheerio from "cheerio";

/** Field boundary keywords — truncate hare/location text at these labels */
const FIELD_BOUNDARIES = [
  "Requirements", "Registration", "Theme", "Cost", "Fee", "Where",
  "Location", "Start", "Time", "What", "When", "Hash cash", "Price",
  "Trail", "Bring", "NO BAG", "Details", "The following", "Afterwards",
  "Map", "THEME", "A to A",
];
const FIELD_BOUNDARY_RE = new RegExp(
  `\\s*(?:${FIELD_BOUNDARIES.map((s) => s.replace(/\s+/g, "\\s+")).join("|")})\\s*:.*`,
  "i",
);
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";

/**
 * Extract the run number from body text.
 * Matches: "Run #75", "#75", "Run Count #58", "run# 64"
 */
export function extractRunNumber(text: string): number | undefined {
  const match = /(?:Run\s*(?:Count\s*)?)?#\s*(\d+)/i.exec(text);
  if (!match) return undefined;
  const num = Number.parseInt(match[1], 10);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Extract hare name(s) from body text.
 * Matches: "Hare: Gerbil Stuffer", "Hares: Jelly Mouth and Crusader",
 *          "Hare : Code Poo", "Live Hare: Peggy Ashuka"
 */
export function extractHare(text: string): string | undefined {
  const match = /(?:Live\s+)?Hares?\s*:\s*(.+)/i.exec(text);
  if (!match) return undefined;
  // Clean up — take only the hare name(s), stop at next field or line break
  let hare = match[1].trim();
  // Truncate at common field boundaries
  hare = hare
    .split(/\n/)[0]
    .replace(FIELD_BOUNDARY_RE, "")
    .trim();
  return hare || undefined;
}

/**
 * Extract location from body text.
 * Matches: "Where: YRP Nobi Station", "Location: Yokosuka Chuo West Exit",
 *          "location: Yotsuya Station"
 */
export function extractLocation(text: string): string | undefined {
  const match = /(?:Where|Location|Venue|Meeting\s*place|Start)\s*:\s*(.+)/i.exec(text);
  if (!match) return undefined;
  let loc = match[1].trim();
  // Stop at next field or line
  loc = loc
    .split(/\n/)[0]
    .replace(/\s*(?:Hares?|Time|Fee|Cost|Registration|Requirements|Theme|Start|When|Hash\s*cash|Price)\s*:.*/i, "")
    .trim();
  return loc || undefined;
}

/**
 * Extract Google Maps URL from body text.
 */
export function extractMapsUrl(text: string): string | undefined {
  const match = /(?:https?:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.com\/maps)[^\s<"')]*)/i.exec(text);
  return match ? match[0].replace(/\.{3}$/, "") : undefined;
}

/**
 * Extract hash fee from body text.
 * Matches: "Cost: 500 yen", "Fee: 500 JPY", "500 yen", "1500 yen"
 */
export function extractFee(text: string): string | undefined {
  // Try labeled field first
  const labeled = /(?:Cost|Fee|Hash\s*cash|Entry\s*Fee|Price)\s*:\s*([^\n]+)/i.exec(text);
  if (labeled) return labeled[1].trim();
  // Try standalone yen amount
  const yen = /[¥￥]?\s*(\d[\d,]*)\s*(?:yen|JPY|円)/i.exec(text);
  if (yen) return `${yen[1]} yen`;
  return undefined;
}

/**
 * Parse a single Y2H3 event cell into RawEventData.
 * Exported for unit testing.
 */
export function parseEventCell(
  cellHtml: string,
  sourceUrl: string,
): RawEventData | null {
  const $ = cheerio.load(cellHtml);

  // --- Title + Facebook link ---
  const headerLink = $("span.eventheader a");
  const title = headerLink.text().trim() || undefined;
  const fbUrl = headerLink.attr("href")?.trim();

  // --- Date from span.eventdate ---
  const dateText = $("span.eventdate").text().trim();
  if (!dateText) return null;

  const date = chronoParseDate(dateText, "en-US");
  if (!date) return null;

  // --- Time from eventdate span ---
  const startTime = parse12HourTime(dateText);

  // --- Body text: everything after the image ---
  // Get the raw HTML, strip images and header/date spans, then extract text
  const bodyHtml = $("td").html() ?? cellHtml;
  const body$ = cheerio.load(bodyHtml);
  body$("span.eventheader").remove();
  body$("span.eventdate").remove();
  body$("img").remove();
  body$("a img").parent().remove();

  // Convert <br> to newlines for line-based parsing
  body$("br").replaceWith("\n");
  const bodyText = body$.text().replaceAll(/[ \t]+/g, " ").trim();

  // --- Extract semi-structured fields ---
  const runNumber = extractRunNumber(bodyText);
  const hares = extractHare(bodyText);
  const location = extractLocation(bodyText);
  const locationUrl = extractMapsUrl(bodyHtml);
  const fee = extractFee(bodyText);

  // Build description from full body text, truncated
  const description = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000) || undefined;

  const externalLinks = fbUrl
    ? [{ url: fbUrl, label: "Facebook Event" }]
    : undefined;

  return {
    date,
    kennelTags: ["yoko-yoko-h3"],
    title,
    runNumber,
    hares,
    location,
    locationUrl,
    startTime,
    sourceUrl,
    description: fee ? `${description ?? ""}\nFee: ${fee}`.trim() : description,
    externalLinks,
  };
}

export class YokoYokoH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://y2h3.net/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const rows = $("table#hareline tr");

    rows.each((i, el) => {
      const $row = $(el);
      const td = $row.find("> td").first();
      if (!td.length) return;

      try {
        const cellHtml = td.html() ?? "";
        const event = parseEventCell(cellHtml, url);
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        if (!errorDetails.parse) errorDetails.parse = [];
        errorDetails.parse.push({
          row: i,
          error: String(err),
          rawText: $row.text().trim().slice(0, 2000),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
