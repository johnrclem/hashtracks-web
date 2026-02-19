import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { MONTHS, parse12HourTime } from "../utils";

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
 * Parse a date from a London Hash run block.
 * Formats:
 *   "Saturday 21st of February" (needs current year inference)
 *   "Saturday 28th of February 2026"
 *   "Monday 22nd June" (summer format)
 *   "21/02/2026"
 */
export function parseDateFromBlock(text: string, referenceYear?: number): string | null {
  const year = referenceYear ?? new Date().getFullYear();

  // Try DD/MM/YYYY format first
  const numericMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    const yr = parseInt(numericMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try "DDth of Month YYYY" or "DDth of Month" or "DDth Month YYYY" or "DDth Month"
  // (?<!\d) prevents matching "20" inside "2820" (the run number)
  const ordinalMatch = text.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(\w+)(?:\s+(\d{4}))?/i,
  );
  if (ordinalMatch) {
    const day = parseInt(ordinalMatch[1], 10);
    const monthNum = MONTHS[ordinalMatch[2].toLowerCase()];
    const yr = ordinalMatch[3] ? parseInt(ordinalMatch[3], 10) : year;
    if (monthNum && day >= 1 && day <= 31) {
      return `${yr}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
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
    const hares = haredByMatch[1].trim();
    // Skip placeholder text
    if (/required|volunteer|tba|tbd|tbc/i.test(hares)) return null;
    return hares;
  }

  // "Hare: Name"
  const hareColonMatch = text.match(/Hare:\s*(.+?)(?:\n|$|\*)/i);
  if (hareColonMatch) {
    const hares = hareColonMatch[1].trim();
    if (/required|volunteer|tba|tbd|tbc/i.test(hares)) return null;
    return hares;
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
    return {
      station: pTrailMatch[1].trim(),
      location: pTrailMatch[2].trim(),
    };
  }

  // "Start: LOCATION" pattern
  const startMatch = text.match(/Start:\s*(.+?)(?:\n|$|\*)/i);
  if (startMatch) {
    return { location: startMatch[1].trim() };
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

/**
 * London Hash House Harriers (LH3) HTML Scraper
 *
 * Scrapes londonhash.org/runlist.php for upcoming runs. The page uses minimal
 * HTML markup — runs are text blocks anchored by nextrun.php links with
 * run data in surrounding text (date, hares, location, time).
 */
export class LondonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.londonhash.org/runlist.php";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;

    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          { url: baseUrl, status: response.status, message },
        ];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    structureHash = generateStructureHash(html);

    const currentYear = new Date().getFullYear();
    const blocks = parseRunBlocks(html);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      try {
        const date = parseDateFromBlock(block.text, currentYear);
        if (!date) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: "runlist", field: "date", error: `No date in block for run #${block.runNumber}` },
          ];
          continue;
        }

        const hares = parseHaresFromBlock(block.text);
        const { location, station } = parseLocationFromBlock(block.text);
        const startTime = parseTimeFromBlock(block.text) ?? "12:00";

        // Build description with station info
        const descParts: string[] = [];
        if (station) descParts.push(`Nearest station: ${station}`);
        const description = descParts.length > 0 ? descParts.join(". ") : undefined;

        const sourceUrl = `https://www.londonhash.org/nextrun.php?run=${block.runId}`;

        events.push({
          date,
          kennelTag: "LH3",
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
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "runlist", error: String(err) },
        ];
      }
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blocks.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
