import * as cheerio from "cheerio";
import type { RawEventData } from "../types";
import { decodeEntities, stripHtmlTags } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * Berlin H3 run detail-page enrichment.
 *
 * The .ics DESCRIPTION published by wordpress-hash-event-api only carries a
 * few free-text lines ("Hash Cash: 5€"), with no structured Hares. The
 * wp-event-manager event page (e.g. /event/full-moon-run-148/) exposes the
 * hares as a labeled "Additional Details" block:
 *
 *   <p class="wpem-additional-info-block-title">
 *     <strong>Hares -</strong> Symphomaniac
 *   </p>
 *
 * This module fetches that page for each upcoming event that hasn't already
 * picked up hares from the ICS description, and sets RawEventData.hares in
 * place. Mirrors the SFH3 detail-enrichment pattern.
 */

const MAX_ENRICH_PER_SCRAPE = 100;
const BATCH_SIZE = 5;

export interface BerlinH3Detail {
  hares?: string;
}

export interface BerlinH3EnrichFailure {
  url: string;
  message: string;
}

type EnrichableEvent = RawEventData & { sourceUrl: string };

/** True if the URL is a Berlin H3 event permalink (either query or pretty form). */
function isBerlinEventUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "berlin-h3.eu" && host !== "www.berlin-h3.eu") return false;
    if (parsed.pathname.startsWith("/event/")) return true;
    // The query-string permalink form is `?post_type=event_listing&p=<id>` — both
    // params must be present. `post_type` alone would match arbitrary WordPress
    // taxonomy URLs that can't be parsed as event pages.
    if (
      parsed.pathname === "/" &&
      parsed.searchParams.get("post_type") === "event_listing" &&
      parsed.searchParams.has("p")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse a Berlin H3 event detail page. Returns the Hares value if present.
 * Handles label variants like "Hares -", "Hares -", "Hare(s) -".
 */
export function parseBerlinH3DetailPage(html: string): BerlinH3Detail {
  const $ = cheerio.load(html);

  let hares: string | undefined;
  $("p.wpem-additional-info-block-title").each((_i, el) => {
    if (hares) return;
    const $p = $(el);
    const labelText = $p.find("strong").first().text().trim();
    // Match "Hares -", "Hare -", "Hare(s) -" (trailing dash/colon optional, case-insensitive)
    if (!/^hares?(?:\(s\))?\s*[-:]?\s*$/i.test(labelText)) return;
    // Grab the paragraph text, subtract the strong label to get the value.
    // Allow optional whitespace before the separator: the separator may sit
    // inside the <strong> (e.g. "Hares -") OR after it (e.g. "Hares</strong> -"),
    // which leaves a leading space in the remainder after slicing.
    const fullText = decodeEntities(stripHtmlTags($p.html() ?? ""))
      .replace(/\s+/g, " ")
      .trim();
    const value = fullText.slice(labelText.length).replace(/^\s*[-:]\s*/, "").trim();
    if (value && value.length < 200) hares = value;
  });

  return { hares };
}

/** Fetch one detail page; throws on non-2xx so Promise.allSettled records it. */
async function fetchBerlinDetailPage(event: EnrichableEvent): Promise<{ html: string; event: EnrichableEvent }> {
  const response = await safeFetch(event.sourceUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${event.sourceUrl}`);
  }
  return { html: await response.text(), event };
}

/**
 * Fetch the event detail page for upcoming Berlin H3 events missing hares,
 * and update them in place. Best-effort, capped at MAX_ENRICH_PER_SCRAPE.
 */
export async function enrichBerlinH3Events(
  events: RawEventData[],
  options: { now?: Date } = {},
): Promise<{ enriched: number; failures: BerlinH3EnrichFailure[] }> {
  const isEnrichable = (e: RawEventData): e is EnrichableEvent =>
    !!e.sourceUrl && !e.hares && isBerlinEventUrl(e.sourceUrl);

  const referenceTime = options.now?.getTime() ?? Date.now();
  // Cutoff is one day behind `now` so events from the past 24h are still
  // eligible for enrichment (a.k.a. "run was last night, detail page may
  // now list the hares"). Keep separate from `todayIso` semantics.
  const cutoffIso = new Date(referenceTime - 86_400_000).toISOString().split("T")[0];
  const toEnrich = events
    .filter((e) => e.date >= cutoffIso)
    .filter(isEnrichable)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_ENRICH_PER_SCRAPE);
  if (toEnrich.length === 0) return { enriched: 0, failures: [] };

  const failures: BerlinH3EnrichFailure[] = [];
  let enriched = 0;

  for (let b = 0; b < toEnrich.length; b += BATCH_SIZE) {
    const batch = toEnrich.slice(b, b + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(fetchBerlinDetailPage));
    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        failures.push({ url: batch[i].sourceUrl, message: String(result.reason) });
        continue;
      }
      const { html, event } = result.value;
      const { hares } = parseBerlinH3DetailPage(html);
      if (hares && !event.hares) {
        event.hares = hares;
        enriched++;
      }
    }
  }

  return { enriched, failures };
}
