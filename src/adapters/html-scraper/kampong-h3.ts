import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { fetchHTMLPage, MONTHS } from "../utils";

const DEFAULT_URL = "https://kampong.hash.org.sg";
const KENNEL_TAG = "kampong-h3";

/**
 * Kampong H3 (Singapore) adapter.
 *
 * kampong.hash.org.sg is a hand-coded static HTML page that displays a single
 * "Next Run" block updated by the kennel each month. Format:
 *
 *   Next Run
 *   Run 296
 *   Date: Saturday, 18 th April 2026
 *   Run starts 5:30PM
 *   Hare: Fawlty Towers
 *   Run site: T.B.A.
 *
 * Only one upcoming event is published at a time, but the page is reliably
 * maintained for the monthly 3rd Saturday hash.
 */

export interface KampongFields {
  runNumber?: number;
  date?: string;
  startTime?: string;
  hares?: string;
  location?: string;
}

/** Parse the "Next Run" text block from kampong.hash.org.sg. */
export function parseKampongNextRun(rawText: string): KampongFields {
  // Collapse non-breaking spaces and normalize whitespace.
  const text = rawText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const result: KampongFields = {};

  const runMatch = /Run\s+(\d{1,4})/i.exec(text);
  if (runMatch) result.runNumber = Number.parseInt(runMatch[1], 10);

  // Date format: "Saturday, 18 th April 2026" — note the "th"/"st"/"nd"/"rd" suffix
  const dateMatch =
    /Date:\s*(?:[A-Za-z]+,?\s*)?(\d{1,2})(?:\s*(?:st|nd|rd|th))?\s+([A-Za-z]+)\s+(\d{4})/i.exec(text);
  if (dateMatch) {
    const day = Number.parseInt(dateMatch[1], 10);
    const monthIdx = MONTHS[dateMatch[2].toLowerCase()];
    const year = Number.parseInt(dateMatch[3], 10);
    if (monthIdx) {
      result.date = `${year}-${String(monthIdx).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Time: "Run starts 5:30PM" or "5:30 PM"
  const timeMatch = /(?:Run\s*starts\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(text);
  if (timeMatch) {
    let hour = Number.parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    result.startTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  // Hare: "Hare: Fawlty Towers" — stop at "Run site" or end
  const hareMatch = /Hare:\s*(.+?)(?:\s+Run\s*site|\s+Date:|$)/i.exec(text);
  if (hareMatch) result.hares = hareMatch[1].trim();

  // Run site: "Run site: T.B.A." — stop at next field or "The Kampong"
  const siteMatch = /Run\s*site:\s*(.+?)(?:\s+The\s+Kampong|\s+Hare:|$)/i.exec(text);
  if (siteMatch) {
    const site = siteMatch[1].trim();
    if (!/^t\.?\s*b\.?\s*a\.?$/i.test(site)) result.location = site;
  }

  return result;
}

export class KampongH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash } = page;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Locate the "Next Run" block. The page is hand-coded HTML so we can't
    // rely on a specific class — find the text node containing "Next Run"
    // and grab a slice of surrounding text.
    const bodyText = $.root().text();
    const nextRunIdx = bodyText.search(/next\s*run/i);
    if (nextRunIdx < 0) {
      errors.push("No 'Next Run' block found on page");
      return { events: [], errors, structureHash };
    }
    const slice = bodyText.slice(nextRunIdx, nextRunIdx + 600);
    const fields = parseKampongNextRun(slice);

    if (!fields.date) {
      errors.push("Could not parse date from Next Run block");
      return {
        events: [],
        errors,
        structureHash,
        diagnosticContext: { sliceSample: slice.replace(/\s+/g, " ").trim().slice(0, 300) },
      };
    }

    const event: RawEventData = {
      date: fields.date,
      startTime: fields.startTime,
      kennelTag: KENNEL_TAG,
      runNumber: fields.runNumber,
      title: fields.runNumber
        ? `Kampong H3 Run ${fields.runNumber}`
        : "Kampong H3 Monthly Run",
      hares: fields.hares,
      location: fields.location,
      sourceUrl: url,
    };

    return {
      events: [event],
      errors,
      structureHash,
      errorDetails: errorDetails.fetch ? errorDetails : undefined,
      diagnosticContext: {
        eventsParsed: 1,
        runNumber: fields.runNumber,
      },
    };
  }
}
