import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";

/**
 * Parse the upcoming-hash block from BoiseH3 home-page HTML.
 *
 * The block structure (Wix server-rendered):
 *   <h1|h2|h3>Hash #NNN - Title</h1>
 *   <p>Monday, MM/DD/YYYY H:MM PM</p>
 *   <p>Venue  Street, City</p>
 *   <p>Trail: ...</p>
 *   <p>Bring: ... (boilerplate — skip)</p>
 *   <p>Hare: Name</p>
 *   <h2>We need Hares!</h2>    ← stop sentinel
 */
export function parseBoiseH3Page(
  html: string,
  sourceUrl: string,
): { event: RawEventData | null; error?: string } {
  const $ = cheerio.load(html);

  let $heading: ReturnType<typeof $> | undefined;
  $("h1, h2, h3, h4, h5, h6").each((_i, el) => {
    if (/Hash\s*#\s*\d+/i.test($(el).text())) {
      $heading = $(el);
      return false;
    }
  });

  if (!$heading) {
    return { event: null, error: "no upcoming-hash heading found on page" };
  }

  const headText = $heading.text().trim();
  const headMatch = /Hash\s*#\s*(\d+)\s*[-–]\s*(.+)/i.exec(headText);
  if (!headMatch) {
    return { event: null, error: `could not parse heading: ${headText.slice(0, 80)}` };
  }
  const runNumber = parseInt(headMatch[1], 10);
  const title = headMatch[2].trim();

  const lines: string[] = [];
  $heading.nextAll().each((_i, el) => {
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

    // Date + time line: "Monday, 05/25/2026 6:40 PM"
    const dtMatch = /(?:[A-Za-z]+,\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(line);
    if (dtMatch && !date) {
      date = chronoParseDate(dtMatch[1], "en-US");
      startTime = parse12HourTime(dtMatch[2]);
      continue;
    }

    // Hare(s) line: "Hare: Name" or "Hares: Name1, Name2"
    const hareMatch = /^Hares?:\s*(.+)$/i.exec(line);
    if (hareMatch) {
      hares = hareMatch[1].trim();
      continue;
    }

    if (/^Trail:/i.test(line)) continue;

    // Skip "Bring:" boilerplate
    if (/^Bring:/i.test(line)) continue;
    if (/^[●•]/u.test(line)) continue;
    if (/^\$\d+\s*Hash\s*Cash/i.test(line)) continue;

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
