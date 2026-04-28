import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchHTMLPage,
  normalizeHaresField,
  stripHtmlTags,
} from "../utils";

/**
 * Bangkok Hash House Bikers (BHHB) adapter.
 *
 * bangkokbikehash.org is a Rails app. The /hash_weekends/upcoming page
 * lists upcoming ride weekends with details. The home page also has a
 * #next-hash section with the next ride.
 *
 * The upcoming page lists rides in card-like sections with:
 *   - Title/heading with ride name
 *   - Date, location, hares
 *
 * Monthly weekend rides (typically Saturday or Sunday).
 */

const KENNEL_TAG = "bhhb";

/**
 * Parse the home page #next-hash section for the next ride.
 * The next ride info is in a section with id="next-hash".
 *
 * Exported for unit testing.
 */
export function parseBikersNextRide(
  html: string,
  sourceUrl: string,
): RawEventData | null {
  // Look for labeled fields in the HTML
  const text = decodeEntities(stripHtmlTags(html, "\n"));

  // Look for date pattern
  const dateMatch = /(?:Date|When)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);
  const dateRaw = dateMatch?.[1]?.trim();
  if (!dateRaw) return null;

  const date = chronoParseDate(dateRaw, "en-GB");
  if (!date) return null;

  const hareMatch = /(?:Hare|Hares?)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);
  const hares = hareMatch?.[1]?.trim();

  const locationMatch = /(?:Location|Where|Resort)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);
  const location = locationMatch?.[1]?.trim();

  const runMatch = /(?:Ride|Run)\s*#?\s*(\d+)/i.exec(text);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares: normalizeHaresField(hares),
    location: location || undefined,
    sourceUrl,
  };
}

export class BangkokBikersAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "http://www.bangkokbikehash.org";

    // Fetch the /hash_weekends/upcoming page (the canonical ride list),
    // NOT just the homepage which only shows the single next ride.
    const upcomingUrl = baseUrl.replace(/\/$/, "") + "/hash_weekends/upcoming";
    const page = await fetchHTMLPage(upcomingUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Try to parse the next ride section from the home page
    const nextHashSection = $("#next-hash").html() ?? $(".next-hash").html() ?? "";
    if (nextHashSection) {
      const nextRide = parseBikersNextRide(nextHashSection, baseUrl);
      if (nextRide) {
        events.push(nextRide);
      }
    }

    // Also try to scrape upcoming rides from the page
    // Look for ride cards/blocks with date info
    $(".hash-weekend, .ride-card, .upcoming-ride").each((i, el) => {
      const text = $(el).text().trim();
      const dateMatch = chronoParseDate(text, "en-GB");
      if (dateMatch) {
        const runMatch = /(?:Ride|Run)\s*#?\s*(\d+)/i.exec(text);
        const hareMatch = /(?:Hare|Hares?)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);

        events.push({
          date: dateMatch,
          kennelTags: [KENNEL_TAG],
          runNumber: runMatch ? Number.parseInt(runMatch[1], 10) : undefined,
          hares: normalizeHaresField(hareMatch?.[1]?.trim()),
          sourceUrl: baseUrl,
        });
      }
    });

    if (events.length === 0) {
      errors.push("BangkokBikers: zero events parsed from website");
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "fetchHTMLPage",
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
