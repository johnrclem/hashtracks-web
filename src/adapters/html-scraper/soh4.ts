import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";
import * as cheerio from "cheerio";
import { chronoParseDate } from "../utils";

/** Unescape iCal property value. Descriptions get \\n → newline; locations do not. */
function unescapeICalValue(raw: string | undefined, expandNewlines: boolean): string | undefined {
  if (!raw) return undefined;
  let v = raw;
  if (expandNewlines) v = v.replace(/\\n/g, "\n");
  v = v.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
  return v || undefined;
}

/**
 * Parse an iCal text block (from SOH4 per-event export) into event fields.
 *
 * Expected fields: SUMMARY, DTSTART (with TZID), DESCRIPTION, LOCATION, CATEGORIES.
 * The iCal export is fetched from: https://www.soh4.com/trails/{num}/?ical=1
 */
export function parseICalText(ical: string): {
  title?: string;
  date?: string;
  startTime?: string;
  description?: string;
  location?: string;
  hares?: string;
} {
  // Unfold iCal lines (continuation lines start with space or tab)
  const unfolded = ical.replace(/\r?\n[ \t]/g, "");

  const getValue = (key: string): string | undefined => {
    // Match both "KEY:value" and "KEY;PARAMS:value"
    const re = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "m");
    const m = re.exec(unfolded);
    return m ? m[1].trim() : undefined;
  };

  const summary = getValue("SUMMARY");
  const dtstart = getValue("DTSTART");
  const description = getValue("DESCRIPTION");
  const location = getValue("LOCATION");

  let date: string | undefined;
  let startTime: string | undefined;

  if (dtstart) {
    // DTSTART formats:
    //   20260316T180900 (local time, TZID in param)
    //   20260316T180900Z (UTC)
    //   20260316 (date only)
    const dtMatch = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(dtstart);
    if (dtMatch) {
      date = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`;
      if (dtMatch[4] && dtMatch[5]) {
        startTime = `${dtMatch[4]}:${dtMatch[5]}`;
      }
    }
  }

  // Parse structured fields from DESCRIPTION (SOH4 uses "Label: Value" patterns)
  const descText = unescapeICalValue(description, true);
  let hares: string | undefined;
  let descLocation: string | undefined;

  if (descText) {
    const haresMatch = /Hares?:\s*(.+?)(?:\n|$)/i.exec(descText);
    if (haresMatch) hares = haresMatch[1].trim();

    const locMatch = /Location:\s*(.+?)(?:\n|$)/i.exec(descText);
    if (locMatch) descLocation = locMatch[1].trim();
  }

  // Strip Google Maps URLs from description (they leak into display text)
  // Preserve non-map URLs (rego/ticket/venue links are useful)
  const cleanDesc = descText
    ?.replace(/https?:\/\/(?:maps\.app\.goo\.gl|maps\.google\.com|www\.google\.com\/maps)\S*/g, "")
    // Strip WordPress template boilerplate instructions
    .replace(/Please include hash name and date of trail in description\.?/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim() || undefined;

  return {
    title: summary || undefined,
    date,
    startTime,
    description: cleanDesc,
    location: unescapeICalValue(location, false) || descLocation,  // prefer LOCATION property
    hares,
  };
}

/**
 * Parse RSS XML to extract trail URLs.
 * Returns an array of { url, title } for each <item> in the feed.
 */
export function parseRssItems(xml: string): Array<{ url: string; title: string }> {
  const $ = cheerio.load(xml, { xml: true });
  const items: Array<{ url: string; title: string }> = [];

  $("item").each((_i, el) => {
    const link = $(el).find("link").first().text().trim();
    const title = $(el).find("title").first().text().trim();
    if (link) {
      items.push({ url: link, title });
    }
  });

  return items;
}

/**
 * Extract trail number from a SOH4 trail URL.
 * e.g., "https://www.soh4.com/trails/821/" → 821
 */
export function extractTrailNumber(url: string): number | undefined {
  const match = /\/trails\/(\d+)\/?/.exec(url);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Syracuse On-On-Dog-A Hash House Harriers & Harriettes (SOH4) Adapter
 *
 * Uses a two-phase approach:
 * 1. Fetch RSS feed at /trails/feed/ for trail index (URLs)
 * 2. For each trail, fetch ?ical=1 endpoint for structured event data
 *
 * The WordPress site uses Divi theme (JS-rendered body), but the RSS feed
 * and per-event iCal exports are machine-readable XML/iCal.
 */
export class SOH4Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const feedUrl = source.url || "https://www.soh4.com/trails/feed/";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Phase 1: Fetch RSS feed
    const fetchStart = Date.now();
    let rssResponse: Response;
    try {
      rssResponse = await safeFetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: feedUrl, message }] } };
    }

    if (!rssResponse.ok) {
      const message = `HTTP ${rssResponse.status}: ${rssResponse.statusText}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: feedUrl, status: rssResponse.status, message }] } };
    }

    const rssXml = await rssResponse.text();
    const structureHash = generateStructureHash(rssXml);
    const items = parseRssItems(rssXml);
    const rssFetchMs = Date.now() - fetchStart;

    // Phase 2: Fetch iCal for each trail (batched to avoid overwhelming target server)
    const BATCH_SIZE = 5;
    const icalFetchStart = Date.now();
    const icalResults: PromiseSettledResult<{ icalText: string; trailUrl: string; rssTitle: string }>[] = [];
    for (let b = 0; b < items.length; b += BATCH_SIZE) {
      const batch = items.slice(b, b + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const trailUrl = item.url.endsWith("/") ? item.url : `${item.url}/`;
          const icalUrl = `${trailUrl}?ical=1`;
          const response = await safeFetch(icalUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${icalUrl}`);
          }
          const text = await response.text();
          return { icalText: text, trailUrl: item.url, rssTitle: item.title };
        }),
      );
      icalResults.push(...batchResults);
    }
    const icalFetchMs = Date.now() - icalFetchStart;

    for (let i = 0; i < icalResults.length; i++) {
      const result = icalResults[i];
      if (result.status === "rejected") {
        const message = `iCal fetch error for ${items[i].url}: ${result.reason}`;
        errors.push(message);
        (errorDetails.fetch ??= []).push({ url: items[i].url, message });
        continue;
      }

      const { icalText, trailUrl, rssTitle } = result.value;

      try {
        const fields = parseICalText(icalText);
        if (!fields.date) {
          // Try to parse date from RSS title as fallback
          const fallbackDate = chronoParseDate(rssTitle, "en-US");
          if (!fallbackDate) {
            errors.push(`No date found for trail: ${trailUrl}`);
            (errorDetails.parse ??= []).push({ row: i, error: "No date in iCal or RSS title", rawText: icalText.slice(0, 2000) });
            continue;
          }
          fields.date = fallbackDate;
        }

        const trailNumber = extractTrailNumber(trailUrl);

        // Build title from iCal SUMMARY or RSS title
        let title: string | undefined = fields.title || rssTitle;
        // Clean up title — remove "Trail #NNN" prefix if present
        if (title) {
          const cleaned = title.replace(/^Trail\s*#?\d+\s*[-–:]\s*/i, "").trim();
          title = cleaned || undefined;
        }

        const event: RawEventData = {
          date: fields.date,
          kennelTag: "SOH4",
          runNumber: trailNumber,
          title: title || (trailNumber ? `SOH4 Trail #${trailNumber}` : "SOH4 Trail"),
          description: fields.description,
          location: fields.location,
          hares: fields.hares,
          startTime: fields.startTime,
          sourceUrl: trailUrl,
        };

        events.push(event);
      } catch (err) {
        errors.push(`Parse error for ${trailUrl}: ${err}`);
        (errorDetails.parse ??= []).push({ row: i, error: String(err), rawText: icalText.slice(0, 2000) });
      }
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rssItemsFound: items.length,
        icalFetched: icalResults.filter((r) => r.status === "fulfilled").length,
        eventsParsed: events.length,
        rssFetchMs,
        icalFetchMs,
        totalFetchMs: rssFetchMs + icalFetchMs,
      },
    };
  }
}
