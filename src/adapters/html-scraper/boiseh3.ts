import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";

// Heading: "Hash #1993 - Memorial Day Hash!" (also handles en-dash and ＃).
const HEADING_RE = /Hash\s*[#＃]\s*(\d+)\s*[-–]\s*(.+)/i;
// Date + time line: "Monday, 05/25/2026 6:40 PM" (optional weekday prefix).
const DATE_TIME_RE = /(?:[A-Za-z]+,\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i;
const HARES_RE = /^Hares?:\s*(.+)$/i;
// Lines that aren't location candidates: section labels, bullet items, hash-cash boilerplate.
const SKIP_LINE_RE = /^(?:Trail:|Bring:|[●•]|\$\d+\s*Hash\s*Cash)/iu;

/**
 * Parse the upcoming-hash block from BoiseH3 home-page HTML.
 *
 * Wix renders each content block inside a `[data-testid="richTextElement"]`
 * container, so the parser climbs to that container before walking siblings
 * (with a fallback to direct heading siblings for simple fixtures). The
 * "We need Hares!" heading acts as the stop sentinel.
 */
export function parseBoiseH3Page(
  html: string,
  sourceUrl: string,
): { event: RawEventData | null; error?: string } {
  const $ = cheerio.load(html);

  const $heading = $("h1, h2, h3, h4, h5, h6")
    .filter((_i, el) => HEADING_RE.test($(el).text()))
    .first();

  if ($heading.length === 0) {
    return { event: null, error: "no upcoming-hash heading found on page" };
  }

  const headText = $heading.text().trim();
  const headMatch = HEADING_RE.exec(headText);
  if (!headMatch) {
    return { event: null, error: `could not parse heading: ${headText.slice(0, 80)}` };
  }
  const runNumber = Number.parseInt(headMatch[1], 10);
  const title = headMatch[2].trim();

  const $richContainer = $heading.closest('[data-testid="richTextElement"]');
  const $walkFrom = $richContainer.length ? $richContainer : $heading;

  const lines: string[] = [];
  $walkFrom.nextAll().each((_i, el) => {
    const tagName = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
    if (/^h[1-6]$/.test(tagName)) return false;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
    return true;
  });

  let date: string | null = null;
  let startTime: string | undefined;
  let location: string | undefined;
  let hares: string | undefined;

  for (const line of lines) {
    if (/we need hares/i.test(line)) break;

    if (!date) {
      const dtMatch = DATE_TIME_RE.exec(line);
      if (dtMatch) {
        date = chronoParseDate(dtMatch[1], "en-US");
        startTime = parse12HourTime(dtMatch[2]);
        continue;
      }
    }

    const hareMatch = HARES_RE.exec(line);
    if (hareMatch) {
      hares = hareMatch[1].trim();
      continue;
    }

    if (SKIP_LINE_RE.test(line)) continue;

    if (!location) {
      location = line;
    } else if (!location.includes(line)) {
      location = `${location}, ${line}`;
    }
  }

  if (!date) {
    return { event: null, error: `could not extract date for Hash #${runNumber}` };
  }

  return {
    event: {
      date,
      kennelTags: ["boiseh3"],
      runNumber,
      title,
      hares,
      location,
      startTime,
      sourceUrl,
    },
  };
}

/**
 * Boise Hash House Harriers (BoiseH3) HTML Scraper.
 *
 * Fetches https://www.boiseh3.org/ (home page) which renders the upcoming
 * Monday hash inline as static HTML. Daily scrape catches every weekly trail;
 * fingerprint dedup handles repeat scrapes between updates.
 */
export class BoiseH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || "https://www.boiseh3.org";
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { event, error } = parseBoiseH3Page(html, url);

    if (!event) {
      return {
        events: [],
        errors: [error ?? "no event found on page"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    return {
      events: [event],
      errors: [],
      structureHash,
      diagnosticContext: { eventsParsed: 1, fetchDurationMs },
    };
  }
}
