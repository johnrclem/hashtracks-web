import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  ErrorDetails,
  RawEventData,
  ScrapeResult,
  SourceAdapter,
} from "../types";
import { hasAnyErrors } from "../types";
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
    .replace(/\s+/g, " ")
    .trim();
  return value || undefined;
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

  // The homepage has a "Next H4 Run" heading followed by inline labels.
  // We grab the visible text and use simple labeled-field extraction since
  // the block layout is template-stable (WordPress page).
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  if (!/Next\s+H4\s+Run/i.test(bodyText)) return null;

  // Narrow to the "Next H4 Run" segment to reduce false matches from
  // unrelated page chrome (e.g. archived posts mentioning a run number).
  const segMatch = /Next\s+H4\s+Run([\s\S]{0,1000}?)(?:Contrary to our reputation|If you wish to contact us|<\/body>|$)/i.exec(html);
  const segment = segMatch ? segMatch[1] : html;

  // Strip tags from the segment for label extraction.
  const segText = segment.replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");

  const runNumberRaw = extractLabeled(segText, /Run\s+Number\s*[:\s]/i);
  const runNumber = runNumberRaw ? Number.parseInt(runNumberRaw.replace(/\D/g, ""), 10) : undefined;

  const location = extractLabeled(segText, /Location\s*[:\s]/i);
  const format = extractLabeled(segText, /Format\s*[:\s]/i);

  // Locate the Google Maps link inside the segment (anchor href).
  const mapMatch = /href="(https?:\/\/(?:maps\.app\.goo\.gl|maps\.google\.[^"\/]+|www\.google\.com\/maps)[^"]*)"/i.exec(segment);
  const locationUrl = mapMatch ? mapMatch[1] : undefined;

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
    try {
      const response = await fetch(baseUrl, {
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
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    const event = parseHkh3Homepage(html, baseUrl);
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
