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
// matching a stray bare "No." inside prose. Leading emoji / punctuation is
// tolerated ("🏃‍♂️🏃‍♀️No. 1840– Sat. November, 07th. 2026", #2614/#2466).
const HEADING_RE = /^[^\p{L}\p{N}]*No\.?\s*(\d{3,5})\b/iu;
// The "Upcoming runs" section heading; the committee spells it "Run UpCuming".
const UPCOMING_HEADING_RE = /up\s*c[ou]m+ing/i;
// A clock time "13:30", "13.30pm", "2:00 PM".
const TIME_RE = /\b(\d{1,2})[.:](\d{2})\s*([ap])?\.?m?\b/i;
// A first-pickup label ("First pick up", "First Pick-up").
const FIRST_PICKUP_RE = /first\s*pick\s*-?\s*up/i;
// A leading pickup time + filler: "13:30 PM sharp at :", "13.30pm:", "2:00 pm at".
const PICKUP_TIME_PREFIX_RE = /^\d{1,2}[.:]\d{2}\s*(?:[ap]\.?m\.?)?(?:\s+sharp)?(?:\s+at\b)?\s*:?\s*/i;
// Pickup / bus-departure wording on the section header, which carries the
// season's start time ("Bus Pick Up: 13.30pm", "the bus leaves at 14.00 pm").
const DEPARTURE_RE = /pick\s*-?\s*up|leaves?\b/i;
// Trailing "(…)" run-type / theme on the heading.
const PAREN_RE = /\(([^)]+)\)\s*$/;
// Ordinal suffix on a day number ("20th" → "20").
const ORDINAL_RE = /(\d)(?:st|nd|rd|th)\b/gi;
// A Google Maps shortlink (the first one in the block is the first pickup). No
// `i` flag: the scheme + host are always lowercase, and `[A-Za-z0-9]` under `/i`
// would duplicate the class (Sonar S5869). The shortcode itself is mixed-case.
const MAPS_URL_RE = /https?:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9]+/;

// Run-TYPE descriptors that are NOT themes → drop so merge.ts synthesizes
// "Hanoi H3 Trail #N". A Set (not object indexing) per Codacy eslint-plugin-security.
const RUN_TYPE_BLOCKLIST = new Set(["a-b run", "a to b run", "a-a run", "a to a run", "city run", "bus run"]);
// Hare placeholders → undefined (no hare assigned yet).
const HARE_PLACEHOLDER_RE = /^(?:hares?\s*needed|tba|tbc|n\/a|none)$/i;
// Lines after the heading that still belong to the run block (the hares <p> sits
// ~13 lines below the heading; 30 comfortably covers it without reaching unrelated content).
const BLOCK_WINDOW = 30;

/** The HTML of the wp-block-column holding the "Upcoming runs" heading (falls back to the full page). */
function scopeToUpcomingColumn(html: string): string {
  const $ = cheerio.load(html);
  const heading = $("h2, h3, h4")
    .filter((_, el) => UPCOMING_HEADING_RE.test($(el).text()))
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

/** The line carrying a "First pick up" / "First Pick-up" label, if any. */
function findFirstPickupLine(block: string[]): string | undefined {
  return block.find((line) => FIRST_PICKUP_RE.test(line));
}

/**
 * First-pickup address: the text after the label's colon, minus a leading
 * "13:30 PM sharp at :" time prefix. The committee sometimes puts a second
 * colon after "at", so the last colon of that prefix wins.
 */
function pickupAddress(line: string | undefined): string | undefined {
  if (!line) return undefined;
  const label = FIRST_PICKUP_RE.exec(line);
  if (!label) return undefined;
  let rest = line.slice(label.index + label[0].length);
  const ci = rest.indexOf(":");
  if (ci === -1) return undefined;
  rest = rest.slice(ci + 1).trim();
  // Drop a leading "13:30 PM sharp at :" time prefix (anchored, word-bounded).
  rest = rest.replace(PICKUP_TIME_PREFIX_RE, "");
  return rest.trim() || undefined;
}

/** "HH:MM" from the first clock time in the text (12h "pm" folded to 24h), else undefined. */
export function parseClockTime(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  let hours = Number.parseInt(m[1], 10);
  const minutes = Number.parseInt(m[2], 10);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "p" && hours < 12) hours += 12;
  if (meridiem === "a" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Location value with the committee's "……" / "…….. Ha Noi." placeholder
 * stripped (#2466). Leading ellipses / dots are dropped; a value that is then
 * only the city name (or empty) carries no venue → undefined, so the geocoder
 * never invents a ward from it.
 */
export function cleanHanoiLocation(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const stripped = raw.replace(/^[\s.\u2026]+/, "").trim();
  const bare = stripped.replace(/[.\s]+$/, "");
  if (!bare || /^(?:ha\s*noi|hanoi)(?:\s+city)?$/i.test(bare)) return undefined;
  return stripped;
}

/**
 * Pick the real run heading among "No.<run#>" candidates. The column can also
 * hold an away-weekend agenda ("No. 1843 Sat, 28, November 2026: Main trail…")
 * ahead of the run block, so prefer the first candidate whose block (up to the
 * next candidate) carries run-block labels; fall back to the first candidate.
 */
function findHeadingIndex(lines: string[]): number {
  const candidates: number[] = [];
  lines.forEach((line, i) => {
    if (HEADING_RE.test(line)) candidates.push(i);
  });
  if (candidates.length === 0) return -1;
  for (let c = 0; c < candidates.length; c++) {
    const start = candidates[c];
    const end = Math.min(candidates[c + 1] ?? lines.length, start + BLOCK_WINDOW);
    const block = lines.slice(start, end);
    if (block.some((line) => FIRST_PICKUP_RE.test(line) || /\bhares?\s*:/i.test(line))) return start;
  }
  return candidates[0];
}

/** Lines above the first "No.<run#>" candidate — the section header only, never an agenda or run block. */
function sectionHeaderLines(lines: string[]): string[] {
  const first = lines.findIndex((line) => HEADING_RE.test(line));
  return first === -1 ? lines : lines.slice(0, first);
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

/**
 * Date (UTC-noon "YYYY-MM-DD") from the heading, or null on parse drift.
 * Year-bearing → no inference. The leading "on" and weekday word are left for
 * chrono to ignore (it locks onto the explicit "Month D YYYY" even when the
 * source weekday disagrees with the date), so no fragile prefix-stripping regex.
 */
function dateFromHeading(heading: string): string | null {
  const normalized = heading
    .replace(HEADING_RE, "")
    .replace(PAREN_RE, "")
    .replace(ORDINAL_RE, "$1")
    .replaceAll(/[,.\u2013\u2014]/g, " ")
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

  const headingIdx = findHeadingIndex(lines);
  if (headingIdx === -1) {
    return { event: null, error: "no 'No.<run#>' run heading found in the Upcoming runs block" };
  }

  // The run-type "(A-A run)" sometimes sits on its own line under the heading.
  const typeOnNextLine =
    !PAREN_RE.test(lines[headingIdx]) && /^\([^)]*\)$/.test(lines[headingIdx + 1] ?? "");
  const heading = typeOnNextLine ? `${lines[headingIdx]} ${lines[headingIdx + 1]}` : lines[headingIdx];
  const blurbIdx = headingIdx + (typeOnNextLine ? 2 : 1);
  const runMatch = HEADING_RE.exec(heading);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  const date = dateFromHeading(heading);
  if (!date) {
    return { event: null, error: `could not extract date for Run #${runNumber ?? "?"} (heading: ${heading})` };
  }

  const block = lines.slice(headingIdx, headingIdx + BLOCK_WINDOW);

  const pickupLine = findFirstPickupLine(block);
  // Start time: the first-pickup time on the run block, else the season time
  // on the section header ("Bus Pick Up: 13.30pm") (#2614).
  const startTime =
    parseClockTime(pickupLine) ??
    parseClockTime(sectionHeaderLines(lines).find((line) => DEPARTURE_RE.test(line) && TIME_RE.test(line)));

  const haresRaw = findValue(block, "hares");
  const hares = haresRaw && !HARE_PLACEHOLDER_RE.test(haresRaw) ? haresRaw : undefined;

  return {
    event: {
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      // title left undefined for run-type-only headings → merge.ts synthesizes "Hanoi H3 Trail #N".
      title: titleFromHeading(heading),
      description: blurbDescription(lines[blurbIdx]),
      startTime,
      hares,
      location: cleanHanoiLocation(findValue(block, "location")),
      locationStreet: pickupAddress(pickupLine),
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
