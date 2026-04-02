import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";
import {
  parseEventsIndex,
  parseKennelEventsPage,
  parseEventDetail,
  splitToRawEvents,
  parseHashRegoDate,
  parseHashRegoTime,
  type IndexEntry,
} from "./parser";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;
const LOOKBACK_DAYS = 7;
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
    const slugList = options?.kennelSlugs ?? [];
    if (slugList.length === 0) {
      return { events: [], errors: ["No kennel slugs provided — check SourceKennel.externalSlug is populated for this source"] };
    }
    const kennelSlugs = new Set(slugList.map((s) => s.toUpperCase()));

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();
    let detailPagesFetched = 0;
    let detailPagesFailed = 0;

    // Step 1: Fetch events index
    let indexHtml: string;
    try {
      const res = await safeFetch("https://hashrego.com/events", {
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
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() + days);

    const isInDateWindow = (dateStr: string) => {
      const date = parseHashRegoDate(dateStr);
      if (!date) return true; // Keep unparseable dates (let detail page try)
      const eventDate = new Date(date + "T12:00:00Z");
      return eventDate >= lookbackDate && eventDate <= cutoffDate;
    };

    const matchingEntries = allEntries.filter((e) =>
      kennelSlugs.has(e.kennelSlug.toUpperCase()) && isInDateWindow(e.startDate),
    );

    // Step 2b: Fetch kennel-specific event pages for slugs absent from the global index entirely
    const globalIndexSlugs = new Set(allEntries.map((e) => e.kennelSlug.toUpperCase()));
    const missingSlugs = [...kennelSlugs].filter((s) => !globalIndexSlugs.has(s));
    const kennelPagesChecked: string[] = [];
    let kennelPageEventsFound = 0;
    const existingSlugs = new Set(matchingEntries.map((e) => e.slug));
    const currentYear = now.getFullYear();

    for (let i = 0; i < missingSlugs.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
      const slug = missingSlugs[i];
      kennelPagesChecked.push(slug);
      try {
        const kennelUrl = `https://hashrego.com/kennels/${slug}/events`;
        const res = await safeFetch(kennelUrl, {
          headers: { "User-Agent": USER_AGENT },
        });
        if (!res.ok) {
          (errorDetails.fetch ??= []).push(
            { url: kennelUrl, status: res.status, message: `Kennel page HTTP ${res.status}` },
          );
          continue;
        }
        const html = await res.text();
        const kennelEntries = parseKennelEventsPage(html, slug, currentYear);

        const filtered = kennelEntries.filter((e) =>
          !existingSlugs.has(e.slug) && isInDateWindow(e.startDate),
        );

        for (const entry of filtered) {
          existingSlugs.add(entry.slug);
          matchingEntries.push(entry);
        }
        kennelPageEventsFound += filtered.length;
      } catch (err) {
        (errorDetails.fetch ??= []).push(
          { url: `https://hashrego.com/kennels/${slug}/events`, message: `Kennel page error: ${err}` },
        );
      }
    }

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
        detailPagesFetched++;
        if (result.status === "fulfilled") {
          events.push(...result.value);
        } else {
          detailPagesFailed++;
        }
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    // Compute unmapped kennel slugs: slugs in the index that weren't in our configured set
    const allIndexSlugs = [...globalIndexSlugs];
    const unmappedKennelSlugs = allIndexSlugs.filter((s) => !kennelSlugs.has(s));

    // Approximate fallback count from detail page errors (each error triggers createFromIndex)
    const indexOnlyFallbacks = (errorDetails.fetch?.length ?? 0) + (errorDetails.parse?.length ?? 0);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        totalIndexEntries: allEntries.length,
        matchingEntries: matchingEntries.length,
        kennelSlugsConfigured: slugList,
        eventsProduced: events.length,
        fetchDurationMs: Date.now() - fetchStart,
        detailPagesFetched,
        detailPagesFailed,
        indexOnlyFallbacks,
        uniqueKennelSlugsInIndex: allIndexSlugs,
        unmappedKennelSlugs,
        kennelPagesChecked,
        kennelPageEventsFound,
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
    const detailRes = await safeFetch(detailUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!detailRes.ok) {
      errors.push(`Detail fetch failed for ${entry.slug}: HTTP ${detailRes.status}`);
      (errorDetails.fetch ??= []).push(
        { url: detailUrl, status: detailRes.status, message: `HTTP ${detailRes.status}` },
      );
      return createFromIndex(entry);
    }

    const detailHtml = await detailRes.text();
    const parsed = parseEventDetail(detailHtml, entry.slug, entry);
    return splitToRawEvents(parsed, entry.slug);
  } catch (err) {
    const msg = `Error processing ${entry.slug}: ${err}`;
    errors.push(msg);
    (errorDetails.parse ??= []).push(
      { row: 0, section: entry.slug, error: String(err), rawText: `Slug: ${entry.slug}\nTitle: ${entry.title ?? "unknown"}\nDate: ${entry.startDate ?? "unknown"}`.slice(0, 2000) },
    );
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
