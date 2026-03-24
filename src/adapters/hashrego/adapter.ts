import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
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

/** Legacy config shape — used as fallback when options.kennelSlugs is not provided. */
interface HashRegoConfig {
  kennelSlugs: string[];
}

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";

/**
 * Hash Rego adapter — scrapes hashrego.com event listings.
 *
 * Strategy:
 * 1. Fetch the events index page (HTML table with all upcoming events)
 * 2. Filter to events from configured kennel slugs + date range
 * 3. Fetch matching event detail pages in parallel batches
 * 4. Parse into RawEventData entries (splitting multi-day events)
 */
export class HashRegoAdapter implements SourceAdapter {
  type = "HASHREGO" as const;

  async fetch(
    source: Source,
    options?: { days?: number; kennelSlugs?: string[] },
  ): Promise<ScrapeResult> {
    // Prefer SourceKennel slugs (new path), fall back to config (legacy path)
    let slugList: string[];
    if (options?.kennelSlugs && options.kennelSlugs.length > 0) {
      slugList = options.kennelSlugs;
    } else {
      try {
        const config = validateSourceConfig<HashRegoConfig>(
          source.config, "HashRegoAdapter", { kennelSlugs: "array" },
        );
        slugList = config.kennelSlugs;
      } catch {
        return { events: [], errors: ["No kennel slugs configured — nothing to scrape"] };
      }
    }

    const kennelSlugs = new Set(slugList.map((s) => s.toUpperCase()));
    if (kennelSlugs.size === 0) {
      return { events: [], errors: ["No kennel slugs configured — nothing to scrape"] };
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();

    // Step 1: Fetch events index
    let indexHtml: string;
    try {
      const res = await fetch("https://hashrego.com/events", {
        headers: { "User-Agent": USER_AGENT },
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

    const structureHash = generateStructureHash(indexHtml);

    // Step 2: Parse index, filter by kennel slugs + date range
    const allEntries = parseEventsIndex(indexHtml);
    const days = options?.days ?? 90;
    const now = new Date();
    const lookbackDate = new Date(now);
    lookbackDate.setDate(lookbackDate.getDate() - days);
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() + days);

    const matchingEntries = allEntries.filter((e) => {
      if (!kennelSlugs.has(e.kennelSlug.toUpperCase())) return false;
      const date = parseHashRegoDate(e.startDate);
      if (!date) return true; // Keep unparseable dates (let detail page try)
      const eventDate = new Date(date + "T12:00:00Z");
      return eventDate >= lookbackDate && eventDate <= cutoffDate;
    });

    // Step 3: Fetch detail pages in parallel batches
    for (let i = 0; i < matchingEntries.length; i += BATCH_SIZE) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
      const batch = matchingEntries.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((entry) => fetchAndParseDetail(entry, errors, errorDetails)),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          events.push(...result.value);
        }
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);
    const slugSource = options?.kennelSlugs ? "sourceKennel" : "config";

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        totalIndexEntries: allEntries.length,
        matchingEntries: matchingEntries.length,
        kennelSlugsConfigured: slugList,
        kennelSlugsSource: slugSource,
        eventsProduced: events.length,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}

/**
 * Fetch and parse a single event's detail page.
 * Returns events on success, fallback events from index data on failure.
 */
async function fetchAndParseDetail(
  entry: IndexEntry,
  errors: string[],
  errorDetails: ErrorDetails,
): Promise<RawEventData[]> {
  try {
    const detailUrl = `https://hashrego.com/events/${entry.slug}`;
    const detailRes = await fetch(detailUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!detailRes.ok) {
      errors.push(`Detail fetch failed for ${entry.slug}: HTTP ${detailRes.status}`);
      errorDetails.fetch = [
        ...(errorDetails.fetch ?? []),
        { url: detailUrl, status: detailRes.status, message: `HTTP ${detailRes.status}` },
      ];
      return createFromIndex(entry);
    }

    const detailHtml = await detailRes.text();
    const parsed = parseEventDetail(detailHtml, entry.slug, entry);
    return splitToRawEvents(parsed, entry.slug);
  } catch (err) {
    const msg = `Error processing ${entry.slug}: ${err}`;
    errors.push(msg);
    errorDetails.parse = [
      ...(errorDetails.parse ?? []),
      { row: 0, section: entry.slug, error: String(err), rawText: `Slug: ${entry.slug}\nTitle: ${entry.title ?? "unknown"}\nDate: ${entry.startDate ?? "unknown"}`.slice(0, 2000) },
    ];
    return createFromIndex(entry);
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
