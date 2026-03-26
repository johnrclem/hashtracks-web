import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchBrowserRenderedPage, HARE_BOILERPLATE_RE } from "../utils";

/**
 * Parse a Google Calendar "render" link into RawEventData.
 *
 * The Wix hareline page embeds "Add to Google Calendar" links with structured
 * event data in query params:
 *   text    = "BTVH3 #846: Season Premier"
 *   dates   = "20260401T223000Z/20260401T233000Z"
 *   details = HTML with hares, cost, length
 *   location = venue string
 */
export function parseCalendarLink(
  href: string,
  sourceUrl: string,
): RawEventData | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const text = url.searchParams.get("text") ?? "";
  const dates = url.searchParams.get("dates") ?? "";
  const details = url.searchParams.get("details") ?? "";
  const location = url.searchParams.get("location") ?? "";

  if (!text || !dates) return null;

  // Parse dates: "20260401T223000Z/20260401T233000Z"
  const dateParts = dates.split("/");
  if (dateParts.length < 1) return null;

  const startUtc = dateParts[0];
  // Parse UTC timestamp: 20260401T223000Z → 2026-04-01 + local time
  const dateMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(startUtc);
  if (!dateMatch) return null;

  const utcDate = new Date(
    Date.UTC(
      parseInt(dateMatch[1]),
      parseInt(dateMatch[2]) - 1,
      parseInt(dateMatch[3]),
      parseInt(dateMatch[4]),
      parseInt(dateMatch[5]),
      parseInt(dateMatch[6]),
    ),
  );

  // Convert to America/New_York local time
  const localStr = utcDate.toLocaleString("en-US", { timeZone: "America/New_York" });
  const localDate = new Date(localStr);

  const yyyy = localDate.getFullYear();
  const mm = String(localDate.getMonth() + 1).padStart(2, "0");
  const dd = String(localDate.getDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;

  const hh = String(localDate.getHours()).padStart(2, "0");
  const min = String(localDate.getMinutes()).padStart(2, "0");
  const startTime = `${hh}:${min}`;

  // Parse title and run number: "BTVH3 #846: Season Premier"
  let title = text.trim();
  let runNumber: number | undefined;
  const runMatch = /(?:BTVH3|BurlyH3|Burlington)\s*#(\d+)\s*[:\-–]\s*(.*)/i.exec(title);
  if (runMatch) {
    runNumber = parseInt(runMatch[1], 10);
    title = runMatch[2].trim() || `BurlyH3 #${runNumber}`;
  }

  // Parse details — strip HTML and extract hares
  const detailText = cheerio.load(details).text().trim();
  let hares: string | undefined;
  const haresMatch = /Hares?:\s*(.+?)(?=Location:|Cost:|HASH CASH|On-On|On On|\n|$)/i.exec(detailText);
  if (haresMatch) {
    hares = haresMatch[1].trim();
    // Clean up trailing punctuation or "Cost:" etc.
    hares = hares.replace(HARE_BOILERPLATE_RE, "").trim();
  }

  return {
    date,
    kennelTag: "burlyh3",
    runNumber,
    title,
    hares,
    location: location.trim() || undefined,
    startTime,
    sourceUrl,
  };
}

/**
 * Burlington Hash House Harriers (BurlyH3) Wix Site Scraper
 *
 * Scrapes burlingtonh3.com/hareline via the NAS headless browser rendering
 * service. The site is built on Wix, which renders content via JavaScript.
 *
 * Event data is extracted from embedded Google Calendar "Add to Calendar" links
 * which contain structured data (title, dates, location, details) as URL params.
 */
export class BurlingtonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl = source.url || "https://www.burlingtonh3.com/hareline";

    const page = await fetchBrowserRenderedPage(harelineUrl, {
      waitFor: "body",
      timeout: 20000,
    });

    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let rowIndex = 0;

    // Find all Google Calendar render links
    $('a[href*="google.com/calendar/render"]').each((_i, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      try {
        const event = parseCalendarLink(href, harelineUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing calendar link at row ${rowIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: rowIndex,
            error: String(err),
            rawText: href.slice(0, 2000),
          },
        ];
      }
      rowIndex++;
    });

    // Deduplicate by run number (Wix may render duplicate elements)
    const seen = new Set<number>();
    const dedupedEvents: RawEventData[] = [];
    for (const event of events) {
      if (event.runNumber && seen.has(event.runNumber)) continue;
      if (event.runNumber) seen.add(event.runNumber);
      dedupedEvents.push(event);
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: dedupedEvents,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        calendarLinksFound: rowIndex,
        eventsParsed: dedupedEvents.length,
        fetchDurationMs,
      },
    };
  }
}
