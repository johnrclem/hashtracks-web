import * as cheerio from "cheerio";
import type { RawEventData } from "../types";
import { appendDescriptionSuffix, decodeEntities, stripHtmlTags } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * SFH3 run detail-page enrichment.
 *
 * sfh3.com serves a per-run detail page at /runs/{id} with a canonical
 * "KENNEL Run #N" title (in a JSON-LD Event block) and a "Comment" field
 * that the iCal feed and hareline table both omit. Both the HTML_SCRAPER
 * and ICAL_FEED adapters rely on this module so whichever one the merge
 * pipeline picks as canonical still has the enriched values.
 */

// Cap sized to cover SFH3's full upcoming-event window (~110-140 events across
// 13 kennels). The iCal SUMMARY never carries "Run #N", so every scrape rebuilds
// RawEvents that all pass sfh3NeedsEnrichment() — a lower cap permanently starves
// events beyond the window (the Aug 15 `26.2H3 Run #7` event, #492/#493, was
// stuck because the first 30 by date were always the earliest upcoming ones).
//
// Wall-time budget under the 120s scrape maxDuration:
//   200 fetches ÷ BATCH_SIZE 10 = 20 batches
//   Per-batch latency on a healthy origin is ~300-500ms; under sustained slow
//   conditions (1-2s/batch) we still finish in 20-40s, leaving room for the
//   .ics fetch + merge pipeline. Enrichment failures are non-fatal so the
//   scrape degrades gracefully if sfh3.com gets slower.
//
// TODO(future): make sfh3NeedsEnrichment() consult the stored DB RawEvent so
// already-enriched events skip the fetch entirely. That would drop steady-state
// cost from ~140 fetches/scrape to ~0 and let us shrink BATCH_SIZE back down.
const MAX_ENRICH_PER_SCRAPE = 200;
const BATCH_SIZE = 10;

export interface SFH3Detail {
  title?: string;
  comment?: string;
}

export interface SFH3EnrichFailure {
  url: string;
  message: string;
}

type EnrichableEvent = RawEventData & { sourceUrl: string };

/** Parse a SFH3 run detail page. Returns the canonical run name and Comment text if present. */
export function parseSFH3DetailPage(html: string): SFH3Detail {
  const $ = cheerio.load(html);

  // Title comes from the JSON-LD Event block (structured, includes "Run #N").
  // Fallback: <title> tag, format "SFH3\n\t- 26.2H3 Run #7" → strip the "SFH3 -" prefix.
  let title: string | undefined;
  $('script[type="application/ld+json"]').each((_i, el) => {
    if (title) return;
    try {
      const data = JSON.parse($(el).text()) as { "@type"?: string; name?: string };
      if (data["@type"] === "Event" && typeof data.name === "string" && data.name.trim()) {
        title = data.name.trim();
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  });
  if (!title) {
    // Use indexOf instead of a regex to avoid greedy-capture ReDoS patterns.
    const tagText = $("title").first().text().replaceAll(/\s+/g, " ").trim();
    const dashIdx = tagText.indexOf(" - ");
    if (dashIdx >= 0 && tagText.slice(0, dashIdx).trim().toUpperCase() === "SFH3") {
      title = tagText.slice(dashIdx + 3).trim();
    }
  }

  // Comment is in a div following the run_comment label.
  // Structure: <label for="run_comment">Comment</label>: … <div class="run_content">Value</div>
  let comment: string | undefined;
  const commentLabel = $('label[for="run_comment"]').first();
  if (commentLabel.length > 0) {
    const contentDiv = commentLabel.closest(".run-key, .run_label").nextAll(".run_content").first();
    const text = decodeEntities(stripHtmlTags(contentDiv.html() ?? "")).replaceAll(/\s+/g, " ").trim();
    if (text) comment = text;
  }

  return { title, comment };
}

/**
 * True when the title is the generic "{kennel slug} [Run|Trail] #N" form
 * that sfh3.com's detail-page JSON-LD serves for every event. Used as the
 * guard before letting a detail-page title OVERRIDE the current title —
 * if the hareline's `td.name` column already gave us something descriptive
 * (e.g. "420 Opening Day Trail, 2026 Edition!"), the generic detail-page
 * title would be a regression.
 *
 * The check is anchored on the event's own `kennelTag`: the title must
 * actually begin with that tag (space- and dot-normalized) before we'll
 * accept it as generic. That way a descriptive single-word-prefix title
 * like "Campout #5" is NOT treated as generic for an Agnews event — its
 * normalized prefix ("campout") isn't the kennel tag. An empty/missing
 * title is always generic.
 */
export function isGenericSFH3Title(title: string | undefined, kennelTag?: string): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  if (trimmed === "") return true;
  // Without the event's kennelTag we can't distinguish "Agnews #1512" from
  // "Campout #5", so fail conservatively and let the caller preserve the
  // existing title.
  if (!kennelTag) return false;
  const normalize = (s: string) => s.replace(/[\s.]+/g, "").toLowerCase();
  const normTitle = normalize(trimmed);
  const normTag = normalize(kennelTag);
  if (!normTag || !normTitle.startsWith(normTag)) return false;
  // After stripping the tag, only a bare "run"/"trail" connective and an
  // optional `#N` run number should remain.
  const tail = normTitle.slice(normTag.length);
  // Require at least one digit — a bare "agnews" or "agnews run" without a
  // run number shouldn't be classified as generic, or we'd let a detail-page
  // JSON-LD title clobber it (CodeRabbit review on PR #568).
  return /^(?:run|trail)?#?\d+$/.test(tail);
}

/** True if the event still needs detail-page enrichment (missing Comment or still has a generic title). */
function sfh3NeedsEnrichment(event: RawEventData): boolean {
  if (!event.sourceUrl || !/sfh3\.com\/runs\/\d+/.test(event.sourceUrl)) return false;
  const descHasComment = !!event.description && /\bComment\s*:/i.test(event.description);
  // Skip the fetch entirely when both sides are already good — the detail
  // page can't improve on a descriptive hareline title + an existing Comment.
  if (descHasComment && !isGenericSFH3Title(event.title, event.kennelTag)) return false;
  return true;
}

/**
 * Apply detail-page extracted fields to an event in place. Returns true if
 * anything changed. The title override is GATED on the current title being
 * generic (#545): SFH3 kennels whose hareline `td.name` column carries a
 * descriptive event name (e.g. "420 Opening Day Trail, 2026 Edition!") must
 * not be clobbered by the detail page's generic JSON-LD title.
 */
function applyDetailToEvent(event: EnrichableEvent, detail: SFH3Detail): boolean {
  let touched = false;
  if (
    detail.title
    && detail.title !== event.title
    && isGenericSFH3Title(event.title, event.kennelTag)
  ) {
    event.title = detail.title;
    touched = true;
  }
  if (detail.comment && !/\bComment\s*:/i.test(event.description ?? "")) {
    event.description = appendDescriptionSuffix(event.description, `Comment: ${detail.comment}`);
    touched = true;
  }
  return touched;
}

/** Fetch one detail page; throws on non-2xx so Promise.allSettled records it as a failure. */
async function fetchSFH3DetailPage(event: EnrichableEvent): Promise<{ html: string; event: EnrichableEvent }> {
  const response = await safeFetch(event.sourceUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${event.sourceUrl}`);
  }
  return { html: await response.text(), event };
}

/**
 * Fetch the run detail page for upcoming events that still need enrichment, and update
 * title + description in place. Best-effort, capped at MAX_ENRICH_PER_SCRAPE per scrape.
 * Skips events that are already enriched (steady state → 0 fetches). Mirrors the SDH3/Frankfurt
 * detail-page enrichment pattern.
 *
 * @param events - Events to consider for enrichment (filtered in place).
 * @param options.now - Reference "now" for the "future events only" filter. Defaults to
 *   the current wall clock. Callers should pass the scrape start time to keep filtering
 *   consistent across a long-running scrape and to make tests deterministic.
 */
export async function enrichSFH3Events(
  events: RawEventData[],
  options: { now?: Date } = {},
): Promise<{ enriched: number; failures: SFH3EnrichFailure[] }> {
  // sfh3NeedsEnrichment guarantees a non-null sourceUrl; the type predicate carries that
  // through the .filter() so we can use event.sourceUrl below without a non-null assertion.
  const isEnrichable = (e: RawEventData): e is EnrichableEvent => sfh3NeedsEnrichment(e);

  // 24h buffer so events still happening "today" in any local timezone aren't dropped
  // when UTC has already rolled over to tomorrow.
  const referenceTime = options.now?.getTime() ?? Date.now();
  const todayIso = new Date(referenceTime - 86_400_000).toISOString().split("T")[0];
  const toEnrich = events
    .filter((e) => e.date >= todayIso)
    .filter(isEnrichable)
    // Sort by date ascending so the per-scrape cap always favors the soonest events
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_ENRICH_PER_SCRAPE);
  if (toEnrich.length === 0) return { enriched: 0, failures: [] };

  const failures: SFH3EnrichFailure[] = [];
  let enriched = 0;

  for (let b = 0; b < toEnrich.length; b += BATCH_SIZE) {
    const batch = toEnrich.slice(b, b + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(fetchSFH3DetailPage));

    // Pair rejected promises with their originating event URL for structured error reporting
    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        failures.push({ url: batch[i].sourceUrl, message: String(result.reason) });
        continue;
      }
      const { html, event } = result.value;
      if (applyDetailToEvent(event, parseSFH3DetailPage(html))) enriched++;
    }
  }

  return { enriched, failures };
}
