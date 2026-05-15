/**
 * Rhode Island Hash House Harriers (RIH3) Hareline Scraper
 *
 * Scrapes rih3.com/hareline.html — a classic static HTML page (CoffeeCup editor,
 * late 1990s) with a 5-column table: Date | Time | Run# | Hare | Directions.
 *
 * Two tables on the page: first is the hareline (upcoming runs), second is the
 * "Hareline Doghouse" (absent members) — skip the second.
 *
 * Dates are year-less (e.g., "Mon March 23") — chrono-node infers the year.
 * Hare names appear in <span> elements and as "and"/"&" text nodes between images.
 * Directions cell contains H2 title, narrative description, and Google Maps links.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  fetchHTMLPage,
  chronoParseDate,
  parse12HourTime,
  isPlaceholder,
  stripHtmlTags,
} from "../utils";

const DAY_PREFIX_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?\s+/i;

/** Reject a locationText that starts with a lowercase preposition/conjunction —
 *  those are sentence fragments bleeding through the strip cascade, not venues.
 *  Case-sensitive to preserve Title-Case venues like "On Tap Sports Bar" or
 *  "In-N-Out Burger". #816. */
const PROSE_LEAD_RE = /^(?:for|in|on|to|at|with|from|near|and|but|so|of|it['’]s|we['’]?re)\b/;

/** Max h2 length before we assume prose has bled into the title and keep
 *  only the first <br>-delimited segment. Motivated by rih3 #2095. #816. */
const MAX_H2_TITLE_LEN = 80;

/** Days to backdate the chrono reference so `forwardDate: true` doesn't push
 *  recent year-less dates (e.g., "March 23") into the next year when scraping
 *  shortly after the event. */
const RECENT_EVENT_TOLERANCE_DAYS = 7;

/** Match a street-address-shaped substring inside a directions paragraph —
 *  some prose followed by `, <City>, <STATE>` (e.g. `2203 Boston Neck Rd,
 *  Saunderstown, RI`). Used by #1427 to prefer the address sentence over
 *  the (sometimes jokey) anchor text of the first maps link in the cell. */
const ADDRESS_PATTERN_RE =
  /([^.<>\n]{6,150}?,\s*[A-Z][A-Za-z\s'.\-]{2,30},\s*[A-Z]{2})\b/;
const STREET_ADDRESS_HINT_RE = /\d|St\.|Street|Rd\.|Road|Ave|Avenue|Blvd|Lane|Ln\.|Way|Park|Beach|Drive|Dr\./i;
/** Strip everything up to and including the last "at"/"from"/"near" when it sits
 *  immediately before the street number — keeps `2203 Boston Neck Rd, …` and
 *  drops `The start is from the small (again) parking lot at`. */
const ADDRESS_LEADIN_RE = /^.*?\b(?:at|from|near)\s+(?=\d)/i;

/**
 * Extract hare name(s) from the hare cell HTML.
 *
 * Hare names appear as text inside <span>/<strong> elements, sometimes with
 * "and" or "&" separators. Extra content (song links, prose) appears in <p>
 * and <a> elements below hare images — removed before text extraction.
 */
export function extractHares(hareHtml: string): string | undefined {
  const $ = cheerio.load(hareHtml);

  // Remove non-hare content
  $("p").remove();
  $("img").remove();
  $("a").remove();
  $("font").remove();

  const text = $("body").text();
  const names = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^(?:and|&)\s+/i, "").trim())
    .filter((n) => n.length > 1 && !isPlaceholder(n));

  return names.length > 0 ? names.join(", ") : undefined;
}

/**
 * Parse a single hareline table row into RawEventData.
 * Exported for unit testing.
 *
 * @param cells - text content of first 3 cells [date, time, runNumber]
 * @param hareHtml - innerHTML of the hare cell (td[3])
 * @param directionHtml - innerHTML of the directions cell (td[4])
 * @param sourceUrl - the source URL for attribution
 * @param referenceDate - reference date for year inference on year-less dates
 */
export function parseHarelineRow(
  cells: string[],
  hareHtml: string,
  directionHtml: string,
  sourceUrl: string,
  referenceDate?: Date,
): RawEventData | null {
  if (cells.length < 3) return null;

  // --- Date (year-less, e.g., "Mon March 23") ---
  const rawDate = cells[0]?.trim();
  if (!rawDate) return null;
  // Backdate reference by RECENT_EVENT_TOLERANCE_DAYS so forwardDate doesn't
  // push recent events to next year (e.g., scraping "March 23" on March 24
  // → 2027 without buffer)
  let ref = referenceDate;
  if (ref) {
    ref = new Date(ref);
    ref.setHours(0, 0, 0, 0);
    ref.setDate(ref.getDate() - RECENT_EVENT_TOLERANCE_DAYS);
  }
  const date = chronoParseDate(rawDate, "en-US", ref, {
    forwardDate: true,
  });
  if (!date) return null;

  // --- Time (12h, e.g., "6:30 PM" or "Mon 6:30 PM") ---
  const rawTime = (cells[1]?.trim() ?? "").replace(DAY_PREFIX_RE, "");
  const startTime = parse12HourTime(rawTime) || "18:30";

  // --- Run Number ---
  const runNum = parseInt(cells[2]?.trim() ?? "", 10);
  const runNumber = !isNaN(runNum) ? runNum : undefined;

  // --- Hares ---
  const hares = extractHares(hareHtml);

  // --- Directions cell: title, location, description ---
  const dir$ = cheerio.load(directionHtml);

  // Title from <h2>. If h2 has multiple <br>-separated segments and the full
  // joined text runs long (prose bleed from unstructured authoring), fall back
  // to the first segment only. #816.
  // Normalize raw CRLF/LF in the HTML source to spaces so formatting line
  // wraps don't get mistaken for <br>-delimited segments. CodeRabbit PR #824.
  const h2Html = (dir$("h2").first().html() ?? "").replace(/\r?\n/g, " ");
  const h2Segments = stripHtmlTags(h2Html, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const h2Joined = h2Segments.join(" ");
  const h2Text =
    h2Joined.length > MAX_H2_TITLE_LEN && h2Segments[0]
      ? h2Segments[0]
      : h2Joined;
  const title =
    h2Text ||
    (runNumber ? `RIH3 #${runNumber}` : "RIH3 Monday Trail");

  // Location preferred from the address-shaped sentence in the directions
  // body (#1427) — the first maps link's anchor text is sometimes a joke,
  // and even the URL can point at the wrong place ("Julia's Trail Parking"
  // instead of the actual start). Fall back to the link's anchor text when
  // no address-shaped match is found.
  const mapsLink = dir$(
    'a[href*="google.com/maps"], a[href*="maps.google"]',
  ).first();
  let location: string | undefined;
  let locationUrl: string | undefined = mapsLink.length
    ? mapsLink.attr("href")?.trim()
    : undefined;

  // 1. Pull the directions body text (stripped HTML, h2 + all <a> anchor
  //    text removed) and scan for a "<text>, <City>, <ST>" substring —
  //    that's the canonical address when the kennel writes one in plain
  //    prose. We remove the link text first so the previous behavior of
  //    extracting from the maps-link anchor still wins when the address
  //    ONLY appears inside the link.
  const bodyForAddress = dir$("body").clone();
  bodyForAddress.find("h2").remove();
  bodyForAddress.find("a").remove();
  const bodyText = bodyForAddress.text().replace(/\s+/g, " ").trim();
  const addressMatch = ADDRESS_PATTERN_RE.exec(bodyText);
  if (addressMatch) {
    const candidate = addressMatch[1]
      .replace(ADDRESS_LEADIN_RE, "")
      .trim();
    // Require a digit somewhere in the candidate so we only latch onto
    // numeric street addresses, not "the dog park at <Proper Noun>".
    if (
      candidate.length >= 8 &&
      candidate.length <= 150 &&
      /\d/.test(candidate) &&
      STREET_ADDRESS_HINT_RE.test(candidate)
    ) {
      location = candidate;
      // Address-text path: the first maps link's URL is often wrong (see #1427
      // map-pin landing at Julia's Trail Parking), so drop it and let
      // downstream geocoding resolve coords from the address text.
      locationUrl = undefined;
    }
  }

  // 2. Fallback — use the maps link's anchor text (legacy behavior).
  if (!location) {
    const linkText = mapsLink.length
      ? mapsLink
          .text()
          .trim()
          // Strip leading navigation instructions (e.g., "Park Here. Just a short bit from the dog park at Melville Park, ...")
          .replace(/^Park\s+Here\.?\s*/i, "")
          .replace(/^(?:Get\s+directions?\s+to|Walk\s+to|Head\s+to|Just\s+)\s*/i, "")
          .replace(/^(?:a\s+)?(?:short\s+)?(?:bit\s+)?(?:from|near|by)\s+(?:the\s+)?/i, "")
          .trim()
      : undefined;
    location =
      linkText && linkText.length > 3 && !PROSE_LEAD_RE.test(linkText)
        ? linkText
        : undefined;
  }

  // Description: body text minus title and song links; preserve Facebook link
  const descRoot = dir$("body").clone();
  descRoot.find("h2").remove();
  descRoot
    .find('a[href*="Songs/"], a[href$=".txt"], a[href$=".rtf"]')
    .closest("p")
    .remove();
  // Convert Facebook link to plain text with URL instead of removing it
  descRoot.find('a[href*="facebook.com/groups"]').each((_, a) => {
    const $a = dir$(a);
    const href = $a.attr("href") ?? "";
    const text = $a.text().trim();
    $a.replaceWith(`${text} (${href})`);
  });
  const description =
    descRoot.text().replace(/\s+/g, " ").trim().replace(/^[,\s]+/, "") ||
    undefined;

  return {
    date,
    kennelTags: ["rih3"],
    title,
    runNumber,
    hares,
    location,
    locationUrl,
    startTime,
    sourceUrl,
    description,
  };
}

export class RIH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl = source.url || "https://rih3.com/hareline.html";

    const page = await fetchHTMLPage(harelineUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const scrapeDate = new Date();

    // First table = hareline events (skip second "Doghouse" table)
    const rows = $("table").first().find("tr");

    rows.each((i, el) => {
      const $row = $(el);
      const tds = $row.find("> td");

      // Skip header row (first row) and malformed rows
      if (i === 0 || tds.length < 5) return;

      try {
        // Extract text for simple columns
        const cells = tds
          .slice(0, 3)
          .map((_, td) => $(td).text().trim())
          .get();

        // Pass raw HTML for complex columns (hare + directions)
        const hareHtml = $(tds[3]).html() ?? "";
        const directionHtml = $(tds[4]).html() ?? "";

        const event = parseHarelineRow(
          cells,
          hareHtml,
          directionHtml,
          harelineUrl,
          scrapeDate,
        );
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
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
