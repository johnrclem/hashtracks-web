/**
 * Edinburgh Hash House Harriers (EH3) HTML Scraper
 *
 * Scrapes edinburghh3.com/eh3-hareline.html for upcoming runs.
 * The site is Weebly-hosted with labeled text blocks for each run:
 *
 *   Run No. 2302
 *   Date 22nd March 2026
 *   Hares Rugrat & Hairspray
 *   Venue Holyrood Park, Meadowbank car park (EH8 7AT)
 *   Time 11:00
 *   Location (w3w): https://w3w.co/scam.spark.sample
 *   Directions Take a No. 4, 5, 26 or 44 Lothian bus...
 *   ON INN: The Bellfield Brewery.
 *
 * Runs are separated by "Run No." boundaries.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage, buildDateWindow, stripPlaceholder, decodeEntities } from "../utils";

/** Parsed fields from a single run block. */
export interface ParsedRun {
  runNumber?: number;
  date?: string; // YYYY-MM-DD
  hares?: string;
  location?: string;
  startTime?: string; // HH:MM
  onInn?: string;
  locationW3W?: string;
  directions?: string;
}

/**
 * Parse a single run text block into structured fields.
 * Returns null if the block has no parseable date.
 * Exported for unit testing.
 */
export function parseRunBlock(block: string): ParsedRun | null {
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const result: ParsedRun = {};

  for (const line of lines) {
    // Run No. NNNN
    const runMatch = /^Run\s+No\.?\s*(\d+)/i.exec(line);
    if (runMatch) {
      result.runNumber = parseInt(runMatch[1], 10);
      continue;
    }

    // Date 22nd March 2026
    const dateMatch = /^Date\s+(.+)/i.exec(line);
    if (dateMatch) {
      const parsed = chronoParseDate(dateMatch[1].trim(), "en-GB");
      if (parsed) result.date = parsed;
      continue;
    }

    // Hares Name & Name
    const haresMatch = /^Hares?\s+(.+)/i.exec(line);
    if (haresMatch) {
      const hares = stripPlaceholder(haresMatch[1]);
      if (hares) result.hares = hares;
      continue;
    }

    // Venue Location text (postcode)
    const venueMatch = /^Venue\s+(.+)/i.exec(line);
    if (venueMatch) {
      const venue = stripPlaceholder(venueMatch[1]);
      if (venue) result.location = venue;
      continue;
    }

    // Time HH:MM (24-hour)
    const timeMatch = /^Time\s+(\d{1,2}:\d{2})/i.exec(line);
    if (timeMatch) {
      const [h, m] = timeMatch[1].split(":").map(Number);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        result.startTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      }
      continue;
    }

    // Location (w3w): URL
    const w3wMatch = /^Location\s*\(w3w\)\s*:?\s*(.+)/i.exec(line);
    if (w3wMatch) {
      result.locationW3W = w3wMatch[1].trim();
      continue;
    }

    // Directions text
    const dirMatch = /^Directions?\s+(.+)/i.exec(line);
    if (dirMatch) {
      result.directions = dirMatch[1].trim();
      continue;
    }

    // ON INN: pub name
    const onInnMatch = /^ON\s+INN\s*:?\s*(.+)/i.exec(line);
    if (onInnMatch) {
      const onInn = stripPlaceholder(onInnMatch[1]);
      if (onInn) result.onInn = onInn;
      continue;
    }
  }

  // Must have a date to be useful
  if (!result.date) return null;

  return result;
}

/**
 * Split full page text into run blocks and parse each one.
 * Exported for unit testing.
 */
export function parseEdinburghRuns(text: string): ParsedRun[] {
  // Split on "Run No." boundaries — each block starts with "Run No."
  const blocks = text.split(/(?=Run\s+No\.?\s*\d)/i);

  const runs: ParsedRun[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const parsed = parseRunBlock(block);
    if (parsed) runs.push(parsed);
  }

  return runs;
}

/**
 * Extract text from a Weebly h2 element's innerHTML, converting <br> to \n.
 * Inserts spaces after inline elements so adjacent <strong>s don't concatenate
 * (Cheerio's .text() merges them without spaces).
 */
function extractWeeblyBlockText(innerHtml: string): string {
  // First collapse all existing whitespace (including template literal newlines) to single spaces
  // THEN convert <br> to newlines — this ensures only <br> produces line breaks
  let html = innerHtml.replace(/\s+/g, " ");
  // Insert spaces after inline closing tags so adjacent elements get separated
  html = html.replace(/<\/(span|strong|font|a|em|b|i)>/gi, "</$1> ");
  // Convert <br> to newlines (the ONLY source of line breaks)
  html = html.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  html = html.replace(/<[^>]+>/g, "");
  // Decode entities, normalize whitespace per line
  return decodeEntities(html)
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .join("\n");
}

export class EdinburghH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://edinburghh3.com/eh3-hareline.html";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 90);

    try {
      // Parse each <h2 class="wsite-content-title"> as a run block.
      // Weebly renders fields inside <strong> with <br> tags for line breaks.
      // Cheerio's .text() ignores <br>, so we walk the DOM recursively,
      // converting <br> to \n to produce parseable per-line output.
      const h2s = $("h2.wsite-content-title");
      const runs: ParsedRun[] = [];
      h2s.each((_, el) => {
        const innerHtml = $(el).html() ?? "";
        const blockText = extractWeeblyBlockText(innerHtml);
        const parsed = parseRunBlock(blockText);
        if (parsed) runs.push(parsed);
      });

      for (const run of runs) {
        if (!run.date) continue;

        // Filter by date window
        const eventDate = new Date(run.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) continue;

        // Build description from ON INN + directions
        const descParts: string[] = [];
        if (run.onInn) descParts.push(`ON INN: ${run.onInn}`);
        if (run.directions) descParts.push(`Directions: ${run.directions}`);
        const description = descParts.length > 0 ? descParts.join("\n") : undefined;

        // Build title
        const title = run.runNumber ? `Edinburgh H3 #${run.runNumber}` : "Edinburgh H3";

        events.push({
          date: run.date,
          kennelTag: "Edinburgh H3",
          runNumber: run.runNumber,
          title,
          hares: run.hares,
          location: run.location,
          locationUrl: run.locationW3W,
          startTime: run.startTime,
          sourceUrl,
          description,
        });
      }
    } catch (err) {
      errors.push(`Parse error: ${err}`);
      (errorDetails.parse ??= []).push({
        row: 0,
        section: "hareline",
        error: String(err),
        rawText: $("body").text().slice(0, 2000),
      });
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
