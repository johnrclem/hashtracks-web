import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { validateSourceConfig, stripHtmlTags, buildDateWindow } from "../utils";
import Parser from "rss-parser";

export interface RssConfig {
  kennelTag: string; // Kennel shortName to assign all events from this feed to
}

/**
 * RSS Feed adapter — fetches events from any RSS 2.0 or Atom 1.0 feed.
 *
 * Suitable for WordPress sites, Blogger/Blogspot (as fallback), and any
 * hash site that publishes a standard RSS feed.
 *
 * Config: { kennelTag: string }
 */
export class RssAdapter implements SourceAdapter {
  type = "RSS_FEED" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: RssConfig;
    try {
      config = validateSourceConfig<RssConfig>(source.config, "RssAdapter", {
        kennelTag: "string",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid source config";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days);

    const errorDetails: ErrorDetails = {};
    const events: RawEventData[] = [];
    const errors: string[] = [];

    const parser = new Parser({ timeout: 10000, maxRedirects: 3 });

    let feed: Awaited<ReturnType<typeof parser.parseURL>>;
    try {
      feed = await parser.parseURL(source.url);
    } catch (err) {
      const message = `Failed to fetch RSS feed: ${err instanceof Error ? err.message : String(err)}`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: source.url, message }] },
      };
    }

    for (const [i, item] of feed.items.entries()) {
      try {
        // Parse date: prefer isoDate (already ISO 8601), fall back to pubDate
        const rawDate = item.isoDate ?? item.pubDate;
        if (!rawDate) continue;

        const itemDate = new Date(rawDate);
        if (isNaN(itemDate.getTime())) continue;

        // Filter to configured window
        if (itemDate < minDate || itemDate > maxDate) continue;

        // Extract YYYY-MM-DD from the raw string when it's ISO 8601 (starts with YYYY-MM-DD).
        // This preserves the publisher's local date and avoids UTC normalization — e.g.
        // "2026-02-22T00:30:00+10:00" must not become "2026-02-21" when UTC-converted.
        const isoMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
        const dateStr = isoMatch
          ? isoMatch[1]
          : [
              itemDate.getFullYear(),
              String(itemDate.getMonth() + 1).padStart(2, "0"),
              String(itemDate.getDate()).padStart(2, "0"),
            ].join("-");

        const title = item.title?.trim() || undefined;

        // item.contentSnippet and item.summary are already HTML-stripped by rss-parser;
        // only strip when falling back to item.content (which contains raw HTML).
        const description = item.content
          ? stripHtmlTags(item.content).slice(0, 2000) || undefined
          : (item.contentSnippet ?? item.summary)?.slice(0, 2000) || undefined;

        const sourceUrl = item.link?.trim() || undefined;

        events.push({
          date: dateStr,
          kennelTag: config.kennelTag,
          title,
          description,
          sourceUrl,
        });
      } catch (err) {
        const msg = `Failed to parse RSS item ${i}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        errorDetails.parse = [...(errorDetails.parse ?? []), { row: i, error: msg }];
      }
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        feedTitle: feed.title,
        feedUrl: feed.feedUrl ?? source.url,
        itemCount: feed.items.length,
      },
    };
  }
}
