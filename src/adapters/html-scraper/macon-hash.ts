import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  chronoParseDate,
  fetchHTMLPage,
  googleMapsSearchUrl,
  isPlaceholder,
} from "../utils";

/**
 * Macon, GA hash adapter — one HTML source (mgh4.com) feeds BOTH kennels.
 *
 * The `/page/next-hash` page (BlogEngine.NET) lists the current/next run for
 * MGH4 (Middle Georgia Hash, Saturdays) and W3H3 (Wednesdays) as prose
 * paragraphs, each led by a bold "KENNEL Weekday, Month DD, YYYY" then the
 * hares / start location / times. Example:
 *   "W3H3 Wednesday, October 29, 2025, Weedeater is laying a trail starting at
 *    Washington Park, Macon. In at 6:30, out at 7."
 *   "MGH4, Saturday, July 19, 2025. Weedeater's birthday trail. Meet at 5650
 *    Arkwright Rd. Congregate at 1:30, out at 2."
 *
 * This is an enrichment source above the two kennels' STATIC_SCHEDULE rows: the
 * page carries only the imminent run per kennel (often stale — the kennel is
 * low-activity), so we emit whatever dated entries are present rather than
 * window-filtering them away. It has no future events today, so it can't
 * collide with (or phantom against) the static placeholders.
 */

const NEXT_HASH_URL = "https://mgh4.com/page/next-hash";

/** Map the leading bold kennel label to its kennelCode. */
function kennelTagFor(label: string): string | undefined {
  const up = label.toUpperCase();
  if (up === "MGH4") return "mgh4";
  if (up === "W3H3") return "w3h3-ga";
  return undefined;
}

const DATE_RE =
  /(?:(?:Sun|Mon|Tues?|Wed(?:nes)?|Thur?s?|Fri|Satur?)[a-z]*,?\s+)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i;

/**
 * Extract a start time from the prose. Prefers the pack-off ("out at N"), then
 * the gather ("in at" / "congregate at"). Macon runs are afternoon/evening, so
 * a bare hour below noon is treated as PM (7 → 19:00, 2 → 14:00).
 */
export function parseMaconTime(text: string): string | undefined {
  const out = /\bout\s+at\s+(\d{1,2})(?::(\d{2}))?/i.exec(text);
  const gather = /(?:\bin\s+at|congregate\s+at)\s+(\d{1,2})(?::(\d{2}))?/i.exec(text);
  const m = out ?? gather;
  if (!m) return undefined;
  let hour = parseInt(m[1], 10);
  const min = m[2] ?? "00";
  if (hour < 12) hour += 12; // afternoon/evening hash assumption
  if (hour > 23) return undefined;
  return `${String(hour).padStart(2, "0")}:${min}`;
}

/** Extract the start location after "starting at" / "meet at" / "start at". */
export function parseMaconLocation(text: string): string | undefined {
  const m = /(?:starting at|start at|meet at)\s+([^.]+?)(?:\.|$)/i.exec(text);
  if (!m) return undefined;
  const loc = m[1].replace(/\s+/g, " ").trim();
  return loc && !isPlaceholder(loc) ? loc : undefined;
}

/** Best-effort hare name: "X is laying" or a leading possessive "X's …". */
export function parseMaconHares(text: string): string | undefined {
  const laying = /\b([A-Z][a-zA-Z]+)\s+(?:is|are)\s+(?:laying|haring|setting)/.exec(text);
  if (laying) return laying[1];
  const poss = /\b([A-Z][a-zA-Z]+)'s\s+\w/.exec(text);
  return poss ? poss[1] : undefined;
}

/** Parse one next-hash paragraph into a RawEventData (null if not a run line). */
export function parseMaconEntry(
  rawText: string,
  sourceUrl: string,
): RawEventData | null {
  // Normalize NBSPs and collapse whitespace.
  const text = rawText.replace(/ /g, " ").replace(/\s+/g, " ").trim();

  const labelMatch = /^(MGH4|W3H3)\b/i.exec(text);
  if (!labelMatch) return null;
  const kennelTag = kennelTagFor(labelMatch[1]);
  if (!kennelTag) return null;

  const dateMatch = DATE_RE.exec(text);
  if (!dateMatch) return null;
  const date = chronoParseDate(dateMatch[1], "en-US");
  if (!date) return null;

  const location = parseMaconLocation(text);

  return {
    date,
    kennelTags: [kennelTag],
    startTime: parseMaconTime(text),
    location,
    locationUrl: location ? googleMapsSearchUrl(location) : undefined,
    hares: parseMaconHares(text),
    sourceUrl,
  };
}

/**
 * Macon (MGH4 + W3H3) next-hash adapter.
 */
export class MaconHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || NEXT_HASH_URL;

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const paragraphs = $("p").toArray();
    for (let i = 0; i < paragraphs.length; i++) {
      const rawText = $(paragraphs[i]).text();
      try {
        const event = parseMaconEntry(rawText, sourceUrl);
        if (event) events.push(event);
      } catch (err) {
        errors.push(`Error parsing paragraph ${i}: ${err}`);
        const parse = (errorDetails.parse ??= []);
        parse.push({
          row: i,
          section: "next-hash",
          error: String(err),
          rawText: rawText.trim().slice(0, 2000),
        });
      }
    }

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "cheerio",
        paragraphs: paragraphs.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
