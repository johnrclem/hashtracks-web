import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { validateSourceConfig } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";
import {
  parseEventsIndex,
  parseEventDetail,
  splitToRawEvents,
  parseHashRegoDate,
  parseHashRegoTime,
  type IndexEntry,
} from "./parser";

interface HashRegoConfig {
  kennelSlugs: string[]; // Hash Rego kennel slugs to watch (e.g., ["BFMH3", "EWH3"])
}

/**
 * Hash Rego adapter — scrapes hashrego.com event listings.
 *
 * Strategy:
 * 1. Fetch the events index page (HTML table with all upcoming events)
 * 2. Filter to events from configured kennel slugs
 * 3. Fetch each matching event's detail page for rich data
 * 4. Parse into RawEventData entries (splitting multi-day events)
 */
export class HashRegoAdapter implements SourceAdapter {
  type = "HASHREGO" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: HashRegoConfig;
    try {
      config = validateSourceConfig<HashRegoConfig>(
        source.config, "HashRegoAdapter", { kennelSlugs: "array" },
      );
    } catch {
      return { events: [], errors: ["No kennelSlugs configured — nothing to scrape"] };
    }
    const kennelSlugs = new Set(
      config.kennelSlugs.map((s) => s.toUpperCase()),
    );

    if (kennelSlugs.size === 0) {
      return {
        events: [],
        errors: ["No kennelSlugs configured — nothing to scrape"],
      };
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;
    const fetchStart = Date.now();

    // Step 1: Fetch events index
    let indexHtml: string;
    try {
      const res = await fetch("https://hashrego.com/events", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
      if (!res.ok) {
        const msg = `Index fetch failed: HTTP ${res.status}`;
        errorDetails.fetch = [{ url: "https://hashrego.com/events", status: res.status, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }
      indexHtml = await res.text();
    } catch (err) {
      const msg = `Index fetch error: ${err}`;
      errorDetails.fetch = [{ url: "https://hashrego.com/events", message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    structureHash = generateStructureHash(indexHtml);

    // Step 2: Parse index and filter by configured kennel slugs
    const allEntries = parseEventsIndex(indexHtml);
    const matchingEntries = allEntries.filter((e) =>
      kennelSlugs.has(e.kennelSlug.toUpperCase()),
    );

    const fetchDurationMs = Date.now() - fetchStart;

    // Step 3: Fetch each matching event's detail page
    for (const entry of matchingEntries) {
      try {
        const detailUrl = `https://hashrego.com/events/${entry.slug}`;
        const detailRes = await fetch(detailUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
        });

        if (!detailRes.ok) {
          errors.push(`Detail fetch failed for ${entry.slug}: HTTP ${detailRes.status}`);
          errorDetails.fetch = [
            ...(errorDetails.fetch ?? []),
            { url: detailUrl, status: detailRes.status, message: `HTTP ${detailRes.status}` },
          ];

          // Fallback: create basic event from index data
          const fallbackEvents = createFromIndex(entry);
          events.push(...fallbackEvents);
          continue;
        }

        const detailHtml = await detailRes.text();
        const parsed = parseEventDetail(detailHtml, entry.slug, entry);
        const rawEvents = splitToRawEvents(parsed, entry.slug);
        events.push(...rawEvents);
      } catch (err) {
        const msg = `Error processing ${entry.slug}: ${err}`;
        errors.push(msg);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: 0, section: entry.slug, error: String(err), rawText: `Slug: ${entry.slug}\nTitle: ${entry.title ?? "unknown"}\nDate: ${entry.startDate ?? "unknown"}`.slice(0, 2000) },
        ];

        // Fallback: create basic event from index data
        const fallbackEvents = createFromIndex(entry);
        events.push(...fallbackEvents);
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
        totalIndexEntries: allEntries.length,
        matchingEntries: matchingEntries.length,
        kennelSlugsConfigured: config.kennelSlugs,
        eventsProduced: events.length,
        fetchDurationMs,
      },
    };
  }
}

/**
 * Create a basic RawEventData from index data when detail page fetch fails.
 * Less rich, but ensures we still capture the event.
 */
function createFromIndex(entry: IndexEntry): RawEventData[] {
  const date = parseHashRegoDate(entry.startDate);
  if (!date) return [];

  const time = parseHashRegoTime(entry.startTime);
  const hashRegoUrl = `https://hashrego.com/events/${entry.slug}`;

  return [
    {
      date,
      kennelTag: entry.kennelSlug,
      title: entry.title,
      startTime: time || undefined,
      sourceUrl: hashRegoUrl,
      externalLinks: [{ url: hashRegoUrl, label: "Hash Rego" }],
    },
  ];
}
