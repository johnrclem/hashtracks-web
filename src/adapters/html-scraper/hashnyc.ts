import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { MONTHS_ZERO, parse12HourTime, decodeEntities, stripHtmlTags } from "../utils";
import { safeFetch } from "../safe-fetch";

// Kennel regex patterns — LONGER strings before shorter substrings
const KENNEL_PATTERNS: [RegExp, string][] = [
  [/Knickerbocker/i, "Knick"],
  [/Queens Black Knights/i, "QBK"],
  [/New Amsterdam/i, "NAH3"],
  [/Long Island(?:\s+Lunatics)?/i, "LIL"],
  [/Staten Island/i, "SI"],
  [/Drinking Practice/i, "Drinking Practice (NYC)"],
  [/Brooklyn/i, "BrH3"],
  [/Harriettes/i, "Harriettes"],
  [/Columbia/i, "Columbia"],
  [/NAWW(?:H3)?/i, "NAWWH3"],
  [/NASS/i, "NAH3"],
  [/GGFM/i, "GGFM"],
  [/BrH3/i, "BrH3"],
  [/NAH3/i, "NAH3"],
  [/Knick/i, "Knick"],
  [/QBK/i, "QBK"],
  [/LIL/i, "LIL"],
  [/SI\b/i, "SI"],
  [/NYC(?:H3)?/i, "NYCH3"],
  [/Queens/i, "QBK"],
  [/Special/i, "Special (NYC)"],
];

/**
 * Decode HTML entities and strip HTML tags from a string.
 * Uses the `he` library (via shared `decodeEntities`) for robust entity decoding,
 * then strips script/style blocks and remaining HTML tags.
 */
export function decodeHtmlEntities(text: string): string {
  return stripHtmlTags(decodeEntities(text));
}

/**
 * Extract year from row ID or date cell.
 * Row IDs look like "2024oct30".
 */
export function extractYear(rowId: string | undefined, dateCellHtml: string): number | null {
  // Try row ID first
  if (rowId) {
    const match = /^(\d{4})/.exec(rowId);
    if (match) return Number.parseInt(match[1], 10);
  }

  // Try date cell HTML
  const htmlMatch = /(\d{4})/.exec(dateCellHtml);
  if (htmlMatch) return Number.parseInt(htmlMatch[1], 10);

  // Try cleaned text
  const cleaned = decodeHtmlEntities(dateCellHtml);
  const textMatch = /(\d{4})/.exec(cleaned);
  if (textMatch) return Number.parseInt(textMatch[1], 10);

  return null;
}

/**
 * Extract month and day from date text.
 * Matches: "October 30", "Jan 5th", "December 1st"
 */
export function extractMonthDay(
  dateText: string,
): { month: number; day: number } | null {
  const match = /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/i.exec(dateText);
  if (!match) return null;

  const monthStr = match[1].toLowerCase();
  const month = MONTHS_ZERO[monthStr];
  if (month === undefined) return null;

  const day = Number.parseInt(match[2], 10);
  return { month, day };
}

/**
 * Extract kennel tag from the details cell text.
 * Two-stage: anchored to start → anywhere in text → fallback to NYCH3.
 */
export function extractKennelTag(text: string): string {
  // Stage 1: Anchored to start of text
  for (const [pattern, tag] of KENNEL_PATTERNS) {
    const anchored = new RegExp(`^\\s*${pattern.source}`, "i");
    if (anchored.test(text)) return tag;
  }

  // Stage 2: Anywhere in text (with run number context)
  for (const [pattern, tag] of KENNEL_PATTERNS) {
    const contextual = new RegExp(
      `${pattern.source}\\s*(?:(?:Run|Trail|#)\\s*\\d+)`,
      "i",
    );
    if (contextual.test(text)) return tag;
  }

  // Fallback: check if there's a run number (likely NYCH3 as default)
  if (/(?:Run|Trail|#)\s*\d+/i.test(text)) return "NYCH3";

  return "NYCH3";
}

/**
 * Extract run number from text.
 */
export function extractRunNumber(text: string): number | undefined {
  const match = /(?:Run|Trail|#)\s*(\d+)/i.exec(text);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * Extract title from the details cell.
 * The title is everything after the kennel/run number prefix.
 */
export function extractTitle(text: string): string | undefined {
  // Remove kennel prefix and run number
  let title = text
    .replace(
      /^[\s\S]*?(?:Run|Trail|#)\s*\d+\s*[:\-–—]?\s*/i,
      "",
    )
    .trim();

  // If the whole text was consumed, try to get everything after ":"
  if (!title) {
    const colonIdx = text.indexOf(":");
    if (colonIdx !== -1) {
      title = text.substring(colonIdx + 1).trim();
    }
  }

  return title || undefined;
}

/**
 * Extract hares from row HTML (PRD Appendix A.3 three-tier extraction).
 */
export function extractHares($: cheerio.CheerioAPI, row: AnyNode): string {
  const cells = $(row).find("td");
  const cellCount = cells.length;

  // Find the "onin" cell index
  let oninIdx = -1;
  cells.each((i, cell) => {
    if ($(cell).hasClass("onin")) {
      oninIdx = i;
      return false; // break
    }
  });

  // Tier 1: Cell immediately before the "onin" cell
  if (oninIdx > 1) {
    const hareCell = cells.eq(oninIdx - 1);
    const hareText = decodeHtmlEntities(hareCell.html() ?? "").trim();
    if (hareText && hareText.length < 100) {
      return hareText;
    }
  }

  // Tier 2: Check cells after the details cell (index 1) for short text with commas
  for (let i = 2; i < cellCount; i++) {
    const cell = cells.eq(i);
    if (cell.hasClass("onin")) continue;
    const text = decodeHtmlEntities(cell.html() ?? "").trim();
    if (
      text &&
      text.length < 100 &&
      (text.includes(",") || text.includes("&") || text.includes(" and "))
    ) {
      return text;
    }
    // Single name (no comma) is also valid if it's short
    if (text && text.length > 0 && text.length < 50 && i === 2) {
      return text;
    }
  }

  return "N/A";
}

/**
 * Extract source URL from a row's deeplink anchor or fallback to first link.
 * Prefers the hashnyc.com page link over Google Maps links.
 */
export function extractSourceUrl(
  $: cheerio.CheerioAPI,
  row: AnyNode,
  baseUrl: string,
): string | undefined {
  // Prefer deeplink anchors (e.g. <a class="deeplink" id="2026February13">)
  const deeplink = $(row).find("a.deeplink[id]").first();
  if (deeplink.length) {
    const id = deeplink.attr("id");
    if (id) return `${baseUrl}/#${id}`;
  }

  // Fallback: first non-maps link
  const links = $(row).find("a[href]");
  let fallback: string | undefined;
  links.each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Skip Google Maps links (those are locationUrl) and mailto links
    if (/maps\./i.test(href) || /google\.\w+\/maps/i.test(href)) return;
    if (/^mailto:/i.test(href)) return;
    if (!fallback) {
      try {
        fallback = new URL(href, baseUrl).toString();
      } catch {
        fallback = href;
      }
    }
  });

  return fallback;
}

/** Parsed fields from a details cell */
interface ParsedDetails {
  kennelTag: string;
  runNumber?: number;
  eventName?: string;
  title?: string;
  location?: string;
  locationUrl?: string;
  description?: string;
}

/** Extract location and location URL from the "Start:" block in cell HTML. */
function extractLocationAndUrl(
  cellHtml: string,
  $: cheerio.CheerioAPI,
  cell: cheerio.Cheerio<AnyNode>,
): { location: string | undefined; locationUrl: string | undefined } {
  let location: string | undefined;
  let locationUrl: string | undefined;

  const startIdx = cellHtml.search(/Start:\s*/i);
  const startLabelMatch = startIdx >= 0 ? /Start:\s*/i.exec(cellHtml) : null;
  if (startIdx >= 0 && startLabelMatch) {
    const blockStart = startIdx + startLabelMatch[0].length;
    const transitIdx = cellHtml.slice(blockStart).search(/Transit:/i);
    const locationBlock = transitIdx >= 0
      ? cellHtml.slice(blockStart, blockStart + transitIdx)
      : cellHtml.slice(blockStart);

    const $block = cheerio.load(`<div>${locationBlock}</div>`);
    const mapsLink = $block("a[href]").filter((_i, el) => {
      const href = $block(el).attr("href") ?? "";
      return /maps\./i.test(href) || /google\.\w+\/maps/i.test(href);
    }).first();

    if (mapsLink.length) {
      locationUrl = mapsLink.attr("href");
    }

    const locationText = decodeHtmlEntities(locationBlock).trim();
    if (locationText) {
      if (/^TBD/i.test(locationText)) {
        location = "TBD";
      } else {
        location = locationText.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
      }
    }
  }

  if (!locationUrl) {
    cell.find("a[href]").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      if (/maps\./i.test(href) || /google\.\w+\/maps/i.test(href)) {
        locationUrl = href;
        return false;
      }
    });
  }

  return { location, locationUrl };
}

/** Extract description from <p> tags or text after Transit line. */
function extractDescriptionFromCell(
  $: cheerio.CheerioAPI,
  cell: cheerio.Cheerio<AnyNode>,
  cellHtml: string,
  cellText: string,
): string | undefined {
  const paragraphs: string[] = [];
  cell.find("p").each((_i, el) => {
    const pText = $(el).text().trim();
    if (pText) paragraphs.push(pText);
  });

  if (paragraphs.length > 0) {
    return paragraphs.join("\n\n");
  }

  const restMatch = /Transit:[^<]*(?:<span[^>]*>[^<]*<\/span>[^<]*)*(?:<br\s*\/?>)([\s\S]*)/i.exec(cellHtml);
  if (restMatch) {
    const rest = decodeHtmlEntities(restMatch[1]).trim();
    if (rest) return rest;
  }

  if (!/Transit:/i.test(cellHtml) && !/Start:/i.test(cellHtml)) {
    let raw = cellText;
    raw = raw.replace(/^[\s\S]*?(?:Run|Trail|#)\s*\d+\s*[:\-–—]?\s*/i, "").trim();
    raw = raw.replace(/Start:[\s\S]*/i, "").trim();
    if (raw && raw.length > 5) return raw;
  }

  return undefined;
}

/** Clean description by removing duplicate title/kennel/location info. */
function cleanEventDescription(desc: string | undefined, eventName: string | undefined): string | undefined {
  let description = desc;
  if (description && eventName) {
    if (description.startsWith(eventName)) {
      description = description.substring(eventName.length).trim();
      if (description.startsWith("-") || description.startsWith("–")) {
        description = description.substring(1).trim();
      }
    }
  }
  if (description) {
    const stripped = description.replace(/^[\w\s]+#\d+\s*/, "").trim();
    if (!stripped) description = undefined;
  }
  return description;
}

/**
 * Parse the details cell HTML structurally (ported from NYCHashEventParser).
 * Extracts: eventName from <b> tags, location from Start:...Transit: block,
 * locationUrl from maps links, description from <p> paragraphs.
 */
export function parseDetailsCell(
  $: cheerio.CheerioAPI,
  cell: cheerio.Cheerio<AnyNode>,
): ParsedDetails {
  const cellHtml = cell.html() ?? "";
  const cellText = decodeHtmlEntities(cellHtml);

  const kennelTag = extractKennelTag(cellText);
  const runNumber = extractRunNumber(cellText);

  let eventName: string | undefined;
  const boldTag = cell.find("b").first();
  if (boldTag.length) {
    const boldText = boldTag.text().trim();
    if (boldText && !/^(Run|Trail|#)\s*\d+$/i.test(boldText) && boldText.length > 1) {
      eventName = boldText;
    }
  }

  let title: string | undefined;
  if (eventName) {
    const designation = runNumber ? `${kennelTag} #${runNumber}` : kennelTag;
    title = `${eventName} - ${designation}`;
  } else {
    const fallbackText = cellText.replace(/Start:[\s\S]*/i, "").trim();
    title = extractTitle(fallbackText) || undefined;
  }

  const { location, locationUrl } = extractLocationAndUrl(cellHtml, $, cell);
  const rawDescription = extractDescriptionFromCell($, cell, cellHtml, cellText);
  const description = cleanEventDescription(rawDescription, eventName);

  return {
    kennelTag,
    runNumber,
    eventName,
    title,
    location,
    locationUrl,
    description,
  };
}

/**
 * Extract time from date cell text.
 * Matches patterns like "4:00 pm", "7:15 pm", "12:00 pm"
 */
export const extractTime = parse12HourTime;

/**
 * Parse rows from a hashnyc.com table (works for both past_hashes and future_hashes).
 */
export function parseRows(
  $: cheerio.CheerioAPI,
  rows: cheerio.Cheerio<AnyNode>,
  baseUrl: string,
  isFuture: boolean,
  section: string = isFuture ? "future_hashes" : "past_hashes",
): { events: RawEventData[]; errors: string[]; parseErrors: ParseError[] } {
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const parseErrors: ParseError[] = [];
  const currentYear = new Date().getFullYear();

  rows.each((_i, row) => {
    try {
      const cells = $(row).find("td");
      if (cells.length < 2) return; // Skip header or malformed rows

      const dateCellHtml = cells.eq(0).html() ?? "";
      const dateCellText = decodeHtmlEntities(dateCellHtml);

      let year: number | null;

      // Extract start time from date cell (works for both past and future)
      const startTime = extractTime(dateCellText);

      if (isFuture) {
        // Future table: year is current year (or next if month < current)
        year = currentYear;
      } else {
        // Past table: row IDs encode date, e.g. "2024oct30"
        const rowId = $(row).attr("id") ?? undefined;
        year = extractYear(rowId, dateCellHtml);
      }

      if (!year || year < 2016) return;

      const monthDay = extractMonthDay(dateCellText);
      if (!monthDay) return;

      // For future events, handle year rollover
      if (isFuture && monthDay.month < new Date().getMonth()) {
        year = currentYear + 1;
      }

      // Build UTC noon date
      const eventDate = new Date(
        Date.UTC(year, monthDay.month, monthDay.day, 12, 0, 0),
      );
      const dateStr = eventDate.toISOString().split("T")[0];

      // Extract details structurally from cell HTML
      const detailsCell = cells.eq(1);
      const parsed = parseDetailsCell($, detailsCell);
      const sourceUrl = extractSourceUrl($, row, baseUrl);

      // Hares: in future table, hares are in cell 2 directly
      let hares: string;
      if (isFuture && cells.length >= 3) {
        hares = decodeHtmlEntities(cells.eq(2).html() ?? "").trim();
      } else {
        hares = extractHares($, row);
      }

      // Filter out "Sign up to hare!" placeholder text
      if (hares && /sign up to hare/i.test(hares)) {
        hares = "N/A";
      }

      events.push({
        date: dateStr,
        kennelTag: parsed.kennelTag,
        runNumber: parsed.runNumber,
        title: parsed.title,
        description: parsed.description,
        hares: hares && hares !== "N/A" ? hares : undefined,
        location: parsed.location,
        locationUrl: parsed.locationUrl,
        startTime,
        sourceUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Row parse error: ${message}`);
      // Capture raw text for AI recovery fallback
      const cells = $(row).find("td");
      const rowText = cells.toArray().map((c) => $(c).text().trim()).join(" | ");
      parseErrors.push({
        row: _i,
        section,
        error: message,
        rawText: rowText.slice(0, 2000),
      });
    }
  });

  return { events, errors, parseErrors };
}

export class HashNYCAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const days = options?.days ?? 90;
    const baseUrl = source.url || "https://hashnyc.com";

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;
    let pastRowCount = 0;
    let futureRowCount = 0;

    // 1. Scrape past events
    const pastUrl = `${baseUrl}/?days=${days}&backwards=true`;
    try {
      const response = await safeFetch(pastUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        allErrors.push(`Past fetch failed: ${message}`);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: pastUrl, status: response.status, message }];
      } else {
        const pastHtml = await response.text();
        structureHash = generateStructureHash(pastHtml);
        const $past = cheerio.load(pastHtml);
        const pastRows = $past("table.past_hashes tr");
        pastRowCount = pastRows.length;
        const past = parseRows($past, pastRows, baseUrl, false, "past_hashes");
        allEvents.push(...past.events);
        allErrors.push(...past.errors);
        if (past.parseErrors.length > 0) {
          errorDetails.parse = [...(errorDetails.parse ?? []), ...past.parseErrors];
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      allErrors.push(`Past fetch failed: ${message}`);
      errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: pastUrl, message }];
    }

    // 2. Scrape upcoming events
    const futureUrl = `${baseUrl}/?days=${days}`;
    try {
      const response = await safeFetch(futureUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        allErrors.push(`Upcoming fetch failed: ${message}`);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: futureUrl, status: response.status, message }];
      } else {
        const futureHtml = await response.text();
        const $future = cheerio.load(futureHtml);
        const futureRows = $future("table.future_hashes tr");
        futureRowCount = futureRows.length;
        const future = parseRows($future, futureRows, baseUrl, true, "future_hashes");
        allEvents.push(...future.events);
        allErrors.push(...future.errors);
        if (future.parseErrors.length > 0) {
          errorDetails.parse = [...(errorDetails.parse ?? []), ...future.parseErrors];
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      allErrors.push(`Upcoming fetch failed: ${message}`);
      errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: futureUrl, message }];
    }

    const hasErrorDetails = (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0;

    return {
      events: allEvents,
      errors: allErrors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        tables: ["past_hashes", "future_hashes"],
        pastRowCount,
        futureRowCount,
      },
    };
  }
}
