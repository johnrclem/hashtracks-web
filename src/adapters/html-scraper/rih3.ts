import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate } from "../utils";

/**
 * Parse a single event block (a set of <dt>/<dd> pairs) into RawEventData.
 *
 * Expected HTML structure per event:
 *   <dt>Date:</dt><dd>Mon. March 9</dd>
 *   <dt>Run</dt><dd>2089</dd>
 *   <dt>Hare:</dt><dd><strong>WIPOS</strong></dd>
 *   <dt>Directions:</dt><dd>[location text + Google Maps link]</dd>
 */
export function parseDtDdBlock(
  fields: Map<string, string>,
  sourceUrl: string,
): RawEventData | null {
  const dateText = fields.get("date");
  if (!dateText) return null;

  const date = chronoParseDate(dateText, "en-US");
  if (!date) return null;

  const runText = fields.get("run");
  const runNumber = runText ? parseInt(runText.trim(), 10) : undefined;

  // Extract hare name — strip "NEED A HARE" style placeholders
  let hares: string | undefined;
  const hareText = fields.get("hare") || fields.get("hares");
  if (hareText) {
    const cleaned = hareText.trim();
    if (!/need\s+a\s+hare|tbd|tba/i.test(cleaned) && cleaned.length > 0) {
      hares = cleaned;
    }
  }

  // Extract location from directions field
  let location: string | undefined;
  let locationUrl: string | undefined;
  const directions = fields.get("directions") || fields.get("location");
  if (directions) {
    // Extract Google Maps URL if present
    const mapMatch = /https?:\/\/(?:www\.)?google\.[a-z.]+\/maps\S*/i.exec(directions);
    if (mapMatch) {
      locationUrl = mapMatch[0];
    }
    // Clean up the text: remove URLs and extra whitespace
    const locationText = directions
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (locationText && !/^\s*$/.test(locationText)) {
      location = locationText;
    }
  }

  const title = runNumber && !isNaN(runNumber)
    ? `RIH3 #${runNumber}`
    : "RIH3 Monday Trail";

  return {
    date,
    kennelTag: "RIH3",
    runNumber: runNumber && !isNaN(runNumber) ? runNumber : undefined,
    title,
    hares,
    location,
    locationUrl,
    startTime: "18:30",
    sourceUrl,
  };
}

/**
 * Rhode Island Hash House Harriers (RIH3) Hareline Scraper
 *
 * Scrapes rih3.com/hareline.html — a plain static HTML page using <dt>/<dd>
 * definition lists separated by <hr> tags. Typically lists 1-2 upcoming runs
 * with hare names and start locations.
 */
export class RIH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl = source.url || "https://rih3.com/hareline.html";

    const page = await fetchHTMLPage(harelineUrl);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let rowIndex = 0;

    // Split content into blocks by <hr> separators
    // The page uses <hr> to separate event blocks
    const blocks = html.split(/<hr\s*\/?>/i);

    for (const block of blocks) {
      const block$ = cheerio.load(block);
      const fields = new Map<string, string>();

      block$("dt").each((_i, dt) => {
        const key = block$(dt).text().replace(/[:\s]+$/, "").trim().toLowerCase();
        const dd = block$(dt).next("dd");
        if (dd.length > 0) {
          const value = dd.text().trim();
          if (key && value) {
            fields.set(key, value);
          }
        }
      });

      if (fields.size === 0) continue;

      try {
        const event = parseDtDdBlock(fields, harelineUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing event block at row ${rowIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: rowIndex,
            error: String(err),
            rawText: block.slice(0, 2000),
          },
        ];
      }
      rowIndex++;
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blocks.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
