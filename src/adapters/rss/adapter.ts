import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { validateSourceConfig, stripHtmlTags } from "../utils";
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

    const days = options?.days ?? 90;
    const now = new Date();
    const minDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

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

        // Date as YYYY-MM-DD — extract from ISO string to avoid timezone shifts
        const dateStr = itemDate.toISOString().slice(0, 10);

        const title = item.title?.trim() || undefined;

        // Strip HTML from content/summary fields
        const rawContent = item.content ?? item.contentSnippet ?? item.summary;
        const description = rawContent
          ? stripHtmlTags(rawContent).slice(0, 2000) || undefined
          : undefined;

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
