import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  ErrorDetails,
  RawEventData,
  ScrapeResult,
  SourceAdapter,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

/**
 * HK H3 (Hong Kong Hash House Harriers, "H4") homepage scraper.
 *
 * The original 1970 founder kennel of the entire Hong Kong scene. The
 * dedicated `?page_id=44` Hareline page returns 404, and the WordPress REST
 * API is gated by iThemes Security (401), so the only reliable scrapeable
 * surface is the homepage's "Next H4 Run" block:
 *
 *   Next H4 Run
 *   Run Number 2969
 *   Location: Hollywood Park Road            ← anchor href = goo.gl maps link
 *   Format: A to A. Bag drop 5:30pm for Walkers
 *   Bus: No
 *   ONONON: Yes
 *   ***BRING HEAD TORCH***
 *
 * The block is emitted as a single RawEvent dated to the next Monday on or
 * after `today` (the kennel runs every Monday at 18:00). A companion
 * STATIC_SCHEDULE source provides multi-week visibility; the merge pipeline's
 * trust ordering (this scraper at trustLevel 8 vs static schedule at 3)
 * lets the rich homepage detail overwrite the upcoming-Monday template.
 */

const KENNEL_TAG = "hkh3";
const DEFAULT_START_TIME = "18:00";

/**
 * Compute the next Monday on-or-after `from` (UTC). If `from` is itself a
 * Monday, returns `from` — STATIC_SCHEDULE alignment relies on identical
 * Date selection so the two sources fingerprint to the same canonical event.
 *
 * Known edge case: a scrape that runs Monday evening after the 18:00 run will
 * still emit "today" rather than next Monday. The event becomes a (recently)
 * past event for ~6h until the next daily scrape rolls it forward. Acceptable
 * given the daily cadence; a clock-time check would couple the adapter to
 * server timezone semantics that aren't worth the complexity for this gap.
 */
export function nextMondayOnOrAfter(from: Date): string {
  const day = from.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const daysUntilMon = (1 - day + 7) % 7; // 0 if already Mon
  const mon = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate() + daysUntilMon,
  ));
  return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
}

/** Labels we know to terminate the previous value (so a multi-line tag-stripped
 * block like "Location\n: \nHollywood Park Road" doesn't bleed into the next
 * field's value). */
const LABEL_STOP_RE = /\b(Run\s+Number|Location|Format|Bus|ONONON|If you wish)\b/i;

/**
 * Extract a labeled value, e.g. text after "Run Number" or "Location:".
 * Tag-stripped HTML often has the value separated from its label by tag
 * boundaries that became newlines, so we walk through whitespace until we
 * find non-empty content, then stop at the next known label.
 */
function extractLabeled(text: string, label: RegExp): string | undefined {
  const m = label.exec(text);
  if (!m) return undefined;
  const after = text.slice(m.index + m[0].length);
  // Walk past leading whitespace + colon noise to find the value content.
  const cleaned = after.replace(/^[\s:]+/, "");
  // Stop at the next known field label.
  const stop = LABEL_STOP_RE.exec(cleaned);
  const value = (stop ? cleaned.slice(0, stop.index) : cleaned)
    .replaceAll(/\s+/g, " ")
    .trim();
  return value || undefined;
}

/**
 * Find the "Next H4 Run" container element in the homepage DOM. The live
 * site renders the label as `<p><strong>Next H4 Run</strong></p>` inside a
 * WPBakery `wpb_text_column` block; older versions used an `<h2>`. We match
 * the heading by text content (not tag) and walk up to its enclosing block.
 * Returns null if the heading isn't present.
 */
function findNextRunContainer($: cheerio.CheerioAPI) {
  // Cheerio's :contains() selector matches any element whose text contains
  // the substring. Restrict to small inline-text holders (strong/h2/h3/p)
  // to avoid matching giant ancestor elements that contain the whole page.
  const heading = $("strong, h1, h2, h3, p").filter((_i, el) => {
    const t = $(el).text().trim();
    return /^Next\s+H4\s+Run\b/i.test(t) && t.length < 100;
  });
  if (heading.length === 0) return null;
  // Walk up several levels to find the section that holds both the heading
  // and the labeled fields below it. Stop once we find an ancestor whose
  // text contains both "Next H4 Run" and "Location" — that's the right
  // bounding block. Capped at 6 hops so we don't blow past the section.
  let cursor = heading.first();
  for (let hop = 0; hop < 6; hop++) {
    const parent = cursor.parent();
    if (parent.length === 0) break;
    cursor = parent;
    const txt = cursor.text();
    if (/Location/i.test(txt) && /Format/i.test(txt)) return cursor;
  }
  return cursor;
}

/**
 * Parse the homepage HTML into a single RawEventData for the upcoming run,
 * or null if the "Next H4 Run" block isn't present.
 *
 * Exported for unit testing.
 */
export function parseHkh3Homepage(
  html: string,
  sourceUrl: string,
  today: Date = new Date(),
): RawEventData | null {
  const $ = cheerio.load(html);

  const container = findNextRunContainer($);
  if (!container) return null;

  // Use cheerio's built-in text extraction — no regex tag stripping needed.
  // Whitespace collapses naturally because text() already returns plain text;
  // collapsing runs of whitespace makes labeled-field extraction predictable.
  const segText = container.text().replaceAll(/[ \t]+/g, " ");

  const runNumberRaw = extractLabeled(segText, /Run\s+Number\s*[:\s]/i);
  const runNumber = runNumberRaw ? Number.parseInt(runNumberRaw.replaceAll(/\D/g, ""), 10) : undefined;

  const location = extractLabeled(segText, /Location\s*[:\s]/i);
  const format = extractLabeled(segText, /Format\s*[:\s]/i);

  // Locate the Google Maps link inside the container (anchor href). Cheerio
  // walks the DOM directly — no URL-shaped regex needed, no ReDoS surface.
  const locationUrl = container
    .find("a[href*='maps.app.goo.gl'], a[href*='maps.google.'], a[href*='google.com/maps']")
    .first()
    .attr("href");

  // Detail strings to weave into the description (skip empties).
  const description = [
    runNumber ? `Run #${runNumber}` : undefined,
    format ? `Format: ${format}` : undefined,
  ].filter(Boolean).join(" — ") || undefined;

  return {
    date: nextMondayOnOrAfter(today),
    kennelTag: KENNEL_TAG,
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
    title: runNumber ? `HK H3 Run #${runNumber}` : "HK H3 Weekly Run",
    location,
    locationUrl,
    description,
    startTime: DEFAULT_START_TIME,
    sourceUrl,
  };
}

export class Hkh3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://hkhash.com/";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let html: string;
    const fetchStart = Date.now();
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await safeFetch(baseUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (HashTracksScraper/1.0; +https://hashtracks.com)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [{ url: baseUrl, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    } finally {
      clearTimeout(fetchTimeout);
    }
    const fetchDurationMs = Date.now() - fetchStart;

    // Anchor `today` to fetch start so all date computations in a single
    // scrape resolve against the same instant (avoids midnight-boundary skew).
    const event = parseHkh3Homepage(html, baseUrl, new Date(fetchStart));
    const structureHash = generateStructureHash(html);

    if (!event) {
      const message = "Could not locate \"Next H4 Run\" block on homepage";
      errorDetails.parse = [{ row: 0, section: "homepage", error: message, rawText: html.slice(0, 2000) }];
      errors.push(message);
    }

    return {
      events: event ? [event] : [],
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        runNumberDetected: event?.runNumber,
        locationDetected: event?.location,
        fetchDurationMs,
      },
    };
  }
}
