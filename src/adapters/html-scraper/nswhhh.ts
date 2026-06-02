import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, chronoParseDate, extractHashRunNumber, formatAmPmTime, stripHtmlTags } from "../utils";
import { extractCoordsFromMapsUrl } from "@/lib/geo";

/**
 * North Shore Wanderers H3 (NSWHHH) — Sydney, NSW.
 *
 * Scrapes the Google Sites home page (https://www.nswhhh.info/home), which
 * server-renders the current week's run as a sequence of labelled lines
 * ("Run #:", "Date:", "Hare:", "Circle up:", "On Inn:", "Directions:") above
 * a "Recent Runs/Walks" prose list. This source exists to enrich the current
 * run with a venue + map coordinates — the hareline Google Sheet source carries
 * the full forward schedule but no location. Both dedup on (kennel, date) at
 * merge.
 *
 * Google Sites wraps every block in deeply nested divs with rotating, opaque
 * class names, so the parser keys entirely on visible text content: it
 * linearizes the body into logical lines (block boundaries + <br> → newline)
 * and classifies each by its label prefix until the "Recent Runs/Walks"
 * sentinel.
 */

const STOP_RE = /Recent Runs/i;
// "6.30pm", "6:30pm", "6.30 pm" — note NSWHHH uses a dot separator. At most one
// space before am/pm, so `\s?` (not `\s*`) — keeps the regex linear (Sonar S5852).
const TIME_RE = /(\d{1,2})[.:](\d{2})\s?(am|pm)/i;
// Labels render with the colon immediately after the word ("Date:", "Hare:",
// "Circle up:") — no `\s*` needed, which also avoids ReDoS-shape lint flags.
const DATE_LABEL_RE = /^Date:/i;
const HARE_LABEL_RE = /^Hares?:/i;
const CIRCLE_LABEL_RE = /^Circle up:/i;
// Placeholder hare ("Hare Wanted", "Hare Needed", "TBA"). Plain alternation with
// word boundaries — no whitespace quantifier adjacent to the group (Sonar S5852).
const HARE_PLACEHOLDER_RE = /\b(?:wanted|needed|tba|tbd)\b/i;

/** Parse the "Date: Monday, 1 June 2026 6.30pm" line into date + start time. */
function parseDateTimeLine(line: string): { date: string | null; startTime: string | undefined } {
  const value = line.replace(DATE_LABEL_RE, "").trim();
  const timeMatch = TIME_RE.exec(value);
  const startTime = timeMatch
    ? formatAmPmTime(Number.parseInt(timeMatch[1], 10), Number.parseInt(timeMatch[2], 10), timeMatch[3])
    : undefined;
  // Strip the time fragment and the leading weekday so chrono sees a clean date.
  let dateText = timeMatch ? value.replace(timeMatch[0], "") : value;
  dateText = dateText.replace(/^[A-Za-z]+,\s?/, "").trim();
  return { date: chronoParseDate(dateText, "en-GB"), startTime };
}

/** Strip trailing "bring your Opal Card…" boilerplate from a "Circle up:" venue. */
function extractVenue(rawValue: string): string | undefined {
  let venue = rawValue;
  const bringIdx = venue.search(/\bbring\b/i);
  if (bringIdx > 0) venue = venue.slice(0, bringIdx);
  // Procedural trailing-strip (commas/ellipsis left by the slice + whitespace).
  // `trim()` clears surrounding whitespace incl. nbsp; the loop removes the
  // trailing punctuation. Avoids the `[\s,…]+$` regex shape Sonar flags as
  // ReDoS-prone (S5852).
  venue = venue.trim();
  while (venue.endsWith(",") || venue.endsWith("…")) {
    venue = venue.slice(0, -1).trim();
  }
  return venue || undefined;
}

/** Coordinates from the embedded Google Maps iframe (prefers the `q=` marker). */
function extractMapData($: cheerio.CheerioAPI): {
  locationUrl: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
} {
  const directions = $('a[href*="maps.app.goo.gl"]').first().attr("href");
  const iframeSrc = $('iframe[src*="/maps"]').first().attr("src");
  const coords = iframeSrc ? extractCoordsFromMapsUrl(iframeSrc) : null;
  return {
    locationUrl: directions || undefined,
    latitude: coords?.lat,
    longitude: coords?.lng,
  };
}

/**
 * Parse the current-run block from the NSWHHH home page.
 */
export function parseNSWHHHPage(
  html: string,
  sourceUrl: string,
): { event: RawEventData | null; error?: string } {
  const { locationUrl, latitude, longitude } = extractMapData(cheerio.load(html));
  // Linearize to logical lines (block boundaries + <br> → newline) — Google
  // Sites wraps content in deeply nested divs with rotating class names, so we
  // key on visible text, not selectors. Same helper the DCFMH3 parser uses.
  const lines = stripHtmlTags(html, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const runIdx = lines.findIndex((line) => /^Run\b/i.test(line) && /\d/.test(line));
  if (runIdx === -1) {
    return { event: null, error: "no 'Run #' heading found on page" };
  }
  const runNumber = extractHashRunNumber(lines[runIdx]);

  const stopOffset = lines.slice(runIdx).findIndex((line) => STOP_RE.test(line));
  const stopIdx = stopOffset === -1 ? lines.length : runIdx + stopOffset;
  // Skip block[0] (the run header — its number is already extracted above).
  const block = lines.slice(runIdx + 1, stopIdx);

  let date: string | null = null;
  let startTime: string | undefined;
  let hares: string | null | undefined;
  let location: string | undefined;
  const notes: string[] = [];

  for (const line of block) {
    if (DATE_LABEL_RE.test(line)) {
      ({ date, startTime } = parseDateTimeLine(line));
      continue;
    }
    if (HARE_LABEL_RE.test(line)) {
      const value = line.replace(HARE_LABEL_RE, "").trim();
      hares = HARE_PLACEHOLDER_RE.test(value) ? null : value || undefined;
      continue;
    }
    if (CIRCLE_LABEL_RE.test(line)) {
      location = extractVenue(line.replace(CIRCLE_LABEL_RE, "").trim());
      continue;
    }
    // Drop the "Directions:" label and the bare directions URL (captured from
    // the DOM above); collect the rest ("Bring torches", "On Inn: …") as notes.
    if (/^Directions:/i.test(line) || /maps\.app\.goo\.gl/i.test(line)) {
      continue;
    }
    notes.push(line);
  }

  if (!date) {
    return { event: null, error: `could not extract date for Run #${runNumber ?? "?"}` };
  }

  const description = notes.length > 0 ? notes.join("\n") : undefined;

  return {
    event: {
      date,
      kennelTags: ["nswhhh"],
      runNumber,
      hares,
      location,
      locationUrl,
      latitude,
      longitude,
      startTime: startTime ?? "18:30",
      description,
      sourceUrl,
    },
  };
}

export class NSWHHHAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  // `options.days` is intentionally ignored: the home page renders exactly one
  // event (the current week's run) with no date-range concept, so there's no
  // window to filter — analogous to the GOOGLE_CALENDAR "API caps its own
  // window" exception in the adapter pitfalls checklist.
  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || "https://www.nswhhh.info/home";
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { event, error } = parseNSWHHHPage(html, url);

    if (!event) {
      return {
        events: [],
        errors: [error ?? "no event found on page"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    return {
      events: [event],
      errors: [],
      structureHash,
      diagnosticContext: { eventsParsed: 1, fetchDurationMs },
    };
  }
}
