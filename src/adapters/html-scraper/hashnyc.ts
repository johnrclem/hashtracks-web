import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";

// Month name → 0-indexed month number
const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

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
 * Decode HTML entities in three passes (PRD Appendix A.4):
 * 1. Named entities (&amp;, &nbsp;, etc.)
 * 2. Hex numeric entities (&#x2019;)
 * 3. Decimal numeric entities (&#8217;)
 * Then strip HTML tags.
 */
function decodeHtmlEntities(text: string): string {
  // 1. Named entities
  let result = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");

  // 2. Hex numeric entities
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  // 3. Decimal numeric entities
  result = result.replace(/&#(\d+);/g, (_m, dec) =>
    String.fromCharCode(parseInt(dec, 10)),
  );

  // Strip HTML tags
  result = result
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return result;
}

/**
 * Extract year from row ID or date cell.
 * Row IDs look like "2024oct30".
 */
function extractYear(rowId: string | undefined, dateCellHtml: string): number | null {
  // Try row ID first
  if (rowId) {
    const match = rowId.match(/^(\d{4})/);
    if (match) return parseInt(match[1], 10);
  }

  // Try date cell HTML
  const htmlMatch = dateCellHtml.match(/(\d{4})/);
  if (htmlMatch) return parseInt(htmlMatch[1], 10);

  // Try cleaned text
  const cleaned = decodeHtmlEntities(dateCellHtml);
  const textMatch = cleaned.match(/(\d{4})/);
  if (textMatch) return parseInt(textMatch[1], 10);

  return null;
}

/**
 * Extract month and day from date text.
 * Matches: "October 30", "Jan 5th", "December 1st"
 */
function extractMonthDay(
  dateText: string,
): { month: number; day: number } | null {
  const match = dateText.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
  if (!match) return null;

  const monthStr = match[1].toLowerCase();
  const month = MONTH_MAP[monthStr];
  if (month === undefined) return null;

  const day = parseInt(match[2], 10);
  return { month, day };
}

/**
 * Extract kennel tag from the details cell text.
 * Two-stage: anchored to start → anywhere in text → fallback to NYCH3.
 */
function extractKennelTag(text: string): string {
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
function extractRunNumber(text: string): number | undefined {
  const match = text.match(/(?:Run|Trail|#)\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Extract title from the details cell.
 * The title is everything after the kennel/run number prefix.
 */
function extractTitle(text: string): string | undefined {
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
function extractHares($: cheerio.CheerioAPI, row: AnyNode): string {
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
 * Extract source URL from a row's HTML.
 */
function extractSourceUrl(
  $: cheerio.CheerioAPI,
  row: AnyNode,
  baseUrl: string,
): string | undefined {
  const link = $(row).find("a[href]").first();
  if (!link.length) return undefined;

  const href = link.attr("href");
  if (!href) return undefined;

  // Resolve relative URLs
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

export class HashNYCAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const days = options?.days ?? 90;
    const baseUrl = source.url || "https://hashnyc.com";
    const url = `${baseUrl}/?days=${days}&backwards=true`;

    const events: RawEventData[] = [];
    const errors: string[] = [];

    let html: string;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
        },
      });
      if (!response.ok) {
        return {
          events: [],
          errors: [`HTTP ${response.status}: ${response.statusText}`],
        };
      }
      html = await response.text();
    } catch (err) {
      return {
        events: [],
        errors: [
          `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }

    const $ = cheerio.load(html);
    const rows = $("table.past_hashes tr");

    // Calculate date range for early termination
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);

    rows.each((_i, row) => {
      try {
        const cells = $(row).find("td");
        if (cells.length < 2) return; // Skip header or malformed rows

        // Extract date
        const rowId = $(row).attr("id") ?? undefined;
        const dateCellHtml = cells.eq(0).html() ?? "";
        const dateCellText = decodeHtmlEntities(dateCellHtml);

        const year = extractYear(rowId, dateCellHtml);
        if (!year || year < 2016) return; // Skip very old rows or headers

        const monthDay = extractMonthDay(dateCellText);
        if (!monthDay) return; // Can't parse date

        // Build UTC noon date
        const eventDate = new Date(
          Date.UTC(year, monthDay.month, monthDay.day, 12, 0, 0),
        );
        const dateStr = eventDate.toISOString().split("T")[0]; // YYYY-MM-DD

        // Extract details
        const detailsHtml = cells.eq(1).html() ?? "";
        const detailsText = decodeHtmlEntities(detailsHtml);

        const kennelTag = extractKennelTag(detailsText);
        const runNumber = extractRunNumber(detailsText);
        const title = extractTitle(detailsText);
        const hares = extractHares($, row);
        const sourceUrl = extractSourceUrl($, row, baseUrl);

        events.push({
          date: dateStr,
          kennelTag,
          runNumber,
          title,
          description: detailsText,
          hares: hares !== "N/A" ? hares : undefined,
          sourceUrl,
        });
      } catch (err) {
        errors.push(
          `Row parse error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    return { events, errors };
  }
}
