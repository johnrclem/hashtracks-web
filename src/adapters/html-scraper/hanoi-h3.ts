/**
 * Traditional Hanoi Hash House Harriers (Hanoi H3) HTML Scraper — Vietnam's
 * second kennel (sibling of Saigon H3).
 *
 * Scrapes hanoih3.com, a WordPress.com-hosted club home page that SSRs a single
 * hand-maintained "Upcoming runs" block holding the CURRENT run only:
 *
 *   No.1820 on saturday, June,20th,2026 (A-B Run)   ← <h4> heading (run # + date + run-type)
 *   <trail blurb prose>
 *   📌 Location: Soc Son outside of Hanoi city.
 *   🚶 Walking : ~6km+   🏃 Running : ~8km+
 *   📍First pick up: 08 Hai Bà Trưng Street … <maps.app.goo.gl shortlink>
 *   ** Second Pick up: … <maps.app.goo.gl shortlink>
 *   🐇 Hares: Faster Than Diarrhea and Finger In Van Dyke   ← separate <p>, below the heading
 *
 * Parsing is scoped to the "Upcoming runs" wp-block-column: a stray
 * "No. 1763 …" caption lives in the adjacent slideshow column and would
 * otherwise shadow the real run heading. Within that column the block spans an
 * <h4> plus following <p> siblings, so we stripHtmlTags the column and scan its
 * text lines (WordPress.com rotates class names — content-keyed, not class-keyed).
 *
 * Date strings are irregular but YEAR-BEARING ("saturday, June,20th,2026") →
 * normalize (strip the run-type parenthetical, leading "on"/weekday, ordinal
 * suffixes, commas → spaces) then chronoParseDate — NO today-anchored inference.
 *
 * Single-surface source: config.upcomingOnly protects reconcile as the committee
 * overwrites the block weekly, and a mandatory fail-loud guard surfaces markup /
 * date drift instead of silently emitting events: [] (the zero-event health
 * alert can't fire on a brand-new source whose baseline is already 0).
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, stripHtmlTags, chronoParseDate } from "../utils";

const KENNEL_TAG = "hanoi-h3";
const DEFAULT_URL = "https://hanoih3.com/";

// Run-heading line: "No." + a 3-5 digit run number. The digit floor avoids
// matching a stray bare "No." inside prose.
const HEADING_RE = /^No\.?\s*(\d{3,5})\b/i;
// Trailing "(…)" run-type / theme on the heading.
const PAREN_RE = /\(([^)]+)\)\s*$/;
// An optional leading "on" and/or weekday word before the date.
const DATE_PREFIX_RE = /^\s*(?:on\b\s*)?(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\b)?\s*/i;
// Ordinal suffix on a day number ("20th" → "20").
const ORDINAL_RE = /(\d)(?:st|nd|rd|th)\b/gi;
// A Google Maps shortlink (the first one in the block is the first pickup).
const MAPS_URL_RE = /https?:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9]+/i;

// Run-TYPE descriptors that are NOT themes → drop so merge.ts synthesizes
// "Hanoi H3 Trail #N". A Set (not object indexing) per Codacy eslint-plugin-security.
const RUN_TYPE_BLOCKLIST = new Set(["a-b run", "a to b run", "city run", "bus run"]);
// Hare placeholders → undefined (no hare assigned yet).
const HARE_PLACEHOLDER_RE = /^(?:hares?\s*needed|tba|tbc|n\/a|none)$/i;
// Lines after the heading that still belong to the run block (the hares <p> sits
// ~13 lines below the heading; 30 comfortably covers it without reaching unrelated content).
const BLOCK_WINDOW = 30;

/** The HTML of the wp-block-column holding the "Upcoming runs" heading (falls back to the full page). */
function scopeToUpcomingColumn(html: string): string {
  const $ = cheerio.load(html);
  const heading = $("h2")
    .filter((_, el) => /upcoming runs/i.test($(el).text()))
    .first();
  if (heading.length === 0) return html;
  const column = heading.closest(".wp-block-column");
  const colHtml = (column.length > 0 ? column : heading.parent()).html();
  return colHtml ?? html;
}

/** Text after the label keyword's colon, e.g. valueAfterLabel("📌 Location: Soc Son", "location") → "Soc Son". */
function valueAfterLabel(line: string, keyword: string): string | undefined {
  const ki = line.toLowerCase().indexOf(keyword);
  if (ki === -1) return undefined;
  const ci = line.indexOf(":", ki);
  if (ci === -1) return undefined;
  const value = line.slice(ci + 1).trim();
  return value || undefined;
}

/** First non-empty labelled value across the block (label keyword + a following ":"). */
function findValue(block: string[], keyword: string): string | undefined {
  for (const line of block) {
    const value = valueAfterLabel(line, keyword);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * First Google Maps shortlink in the block (the first pickup). The committee
 * sometimes glues the next run's "No." heading template directly onto the bare
 * shortlink ("…Tik7No."); goo.gl shortcodes never end in a period, so a captured
 * shortcode that ends in "No" and is immediately followed by "." in the source is
 * that artifact → strip it.
 */
function findFirstMapsUrl(block: string[]): string | undefined {
  for (const line of block) {
    const m = MAPS_URL_RE.exec(line);
    if (!m) continue;
    const url = m[0];
    const after = line.charAt(m.index + url.length);
    if (after === "." && url.endsWith("No")) return url.slice(0, -2);
    return url;
  }
  return undefined;
}

/** Run-type "(A-B Run)" → undefined; a real occasion/theme → kept as the title. */
function titleFromHeading(heading: string): string | undefined {
  const paren = PAREN_RE.exec(heading);
  if (!paren) return undefined;
  const candidate = paren[1].trim();
  if (RUN_TYPE_BLOCKLIST.has(candidate.toLowerCase())) return undefined;
  return candidate || undefined;
}

/** Date (UTC-noon "YYYY-MM-DD") from the heading, or null on parse drift. Year-bearing → no inference. */
function dateFromHeading(heading: string): string | null {
  const normalized = heading
    .replace(HEADING_RE, "")
    .replace(PAREN_RE, "")
    .replace(DATE_PREFIX_RE, "")
    .replace(ORDINAL_RE, "$1")
    .replaceAll(",", " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return chronoParseDate(normalized);
}

/** Trail length display string from the "Walking" / "Running" lines (numeric bounds left open — "+"). */
function trailLengthFromBlock(block: string[]): string | undefined {
  const walking = findValue(block, "walking");
  const running = findValue(block, "running");
  const parts: string[] = [];
  if (walking) parts.push(`Walking ${walking}`);
  if (running) parts.push(`Running ${running}`);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

/** A prose blurb line carries no "label:" and no URL — distinguishes it from the labelled detail lines. */
function blurbDescription(line: string | undefined): string | undefined {
  if (!line) return undefined;
  if (line.includes(":") || /https?:\/\//i.test(line)) return undefined;
  return line;
}

/**
 * Parse the current-run block from the Hanoi H3 home page.
 */
export function parseHanoiH3Page(
  html: string,
  sourceUrl: string,
): { event: RawEventData | null; error?: string } {
  const lines = stripHtmlTags(scopeToUpcomingColumn(html), "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const headingIdx = lines.findIndex((line) => HEADING_RE.test(line));
  if (headingIdx === -1) {
    return { event: null, error: "no 'No.<run#>' run heading found in the Upcoming runs block" };
  }

  const heading = lines[headingIdx];
  const runMatch = HEADING_RE.exec(heading);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  const date = dateFromHeading(heading);
  if (!date) {
    return { event: null, error: `could not extract date for Run #${runNumber ?? "?"} (heading: ${heading})` };
  }

  const block = lines.slice(headingIdx, headingIdx + BLOCK_WINDOW);

  const haresRaw = findValue(block, "hares");
  const hares = haresRaw && !HARE_PLACEHOLDER_RE.test(haresRaw) ? haresRaw : undefined;

  return {
    event: {
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      // title left undefined for run-type-only headings → merge.ts synthesizes "Hanoi H3 Trail #N".
      title: titleFromHeading(heading),
      description: blurbDescription(lines[headingIdx + 1]),
      hares,
      location: findValue(block, "location"),
      locationStreet: findValue(block, "first pick up"),
      locationUrl: findFirstMapsUrl(block),
      trailLengthText: trailLengthFromBlock(block),
      sourceUrl,
    },
  };
}

/**
 * Traditional Hanoi Hash House Harriers (Hanoi H3) HTML Scraper.
 *
 * Fetches the WordPress.com home page (static SSR — no browser render needed).
 * Daily scrape catches each week's Saturday run; fingerprint dedup handles repeat
 * scrapes between updates. A single content block → fail loud on parse drift so
 * reconcile is suppressed and the failure surfaces.
 */
export class HanoiH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  // `options.days` is intentionally ignored: the home page renders exactly one
  // event (the current week's run) with no date-range concept to filter.
  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { event, error } = parseHanoiH3Page(html, url);

    if (!event) {
      return {
        events: [],
        errors: [error ?? "Hanoi H3: no run block parsed"],
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
