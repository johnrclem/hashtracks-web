import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, stripHtmlTags, chronoParseDate, MONTHS } from "../utils";

/**
 * Colombo Hash House Harriettes (colombo-harriettes) — Colombo, Sri Lanka.
 *
 * HashTracks' first Sri Lanka kennel: mixed-gender, est. 20 June 1984, weekly
 * Saturday. The custom Next.js home page server-renders a single "Next run"
 * block — a `<p>` heading ("Next run") whose immediate sibling `<p>` carries
 * either the placeholder or the run detail:
 *
 *   <div>
 *     <p class="… bg-ch-light-yellow …">Next run</p>
 *     <p class="…">We will announce soon</p>     ← placeholder (between postings)
 *   </div>
 *
 * When a run IS posted the same slot fills with a run number, date, start time,
 * venue, street address, and a Google Maps embed iframe. The committee runs
 * weekly but posts the next Saturday only a few days ahead, so the page sits in
 * the placeholder state much of the week — that is a LEGITIMATE 0-event outcome,
 * NOT a parse failure.
 *
 * Detection keys on the visible "Next run" heading text (not CSS class — the
 * "Thinking of Joining the Fun?" block shares the same yellow class), then reads
 * the heading's parent `<div>`, which bounds the block exactly. `stripHtmlTags`
 * linearizes whatever element shape the committee uses (one `<p>` with `<br>`s
 * or several `<p>`s) into visible-text lines.
 *
 * Single current-run page (no archive): `config.upcomingOnly: true` protects
 * reconcile as the run ages off, and a three-way fail-loud guard distinguishes
 * the clean placeholder from genuine markup drift so a silent `events: []` can't
 * ship on a brand-new source whose health baseline is already 0.
 *
 * ⚠️ The FILLED-state DOM is unconfirmed: the live site was in its placeholder
 * state during onboarding, so the run-detail extraction (run #, date, time,
 * venue/street, coords) is built against the documented Run #2223 sample
 * (2026-06-20, KK's Crib, 17:00, No.5 1st Cross Street Kandawala Road Ratmalana).
 * The fail-loud guard surfaces the real markup the first time a run is posted if
 * it diverges, so this can be refined without shipping corrupt data.
 */

const KENNEL_TAG = "colombo-harriettes";
const DEFAULT_URL = "https://hashcolombo.com/";

// Between-postings placeholder, matched against the collapsed block text.
const PLACEHOLDER_RE = /we\s+will\s+announce\s+soon/i;
// "Run #2223" → run number. `\s*` is only adjacent to a literal, so it stays linear.
const RUN_NUMBER_RE = /#\s*(\d{3,5})\b/;
// ISO date, anchored to plausible 20xx years (the documented filled format).
const ISO_DATE_RE = /\b20\d{2}-\d{2}-\d{2}\b/;
// "5:00 PM" / "5 PM" → 12-hour time (the kennel publishes "5:00 PM").
const TIME_12H_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
// "17:00" → 24-hour time (the documented filled sample).
const TIME_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
// A single time token on its own line (for venue exclusion).
const TIME_ONLY_RE = /^(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{2})?(?:am|pm))$/i;
// Street/venue hints — simple literal alternatives (no `\s*`-adjacent groups, S5852-safe).
const STREET_HINT_RE = /\b(?:street|road|lane|mawatha|avenue|terrace|cross|junction|place)\b/i;
// Google Maps embed coords: !2d<lng>!3d<lat>. `extractCoordsFromMapsUrl` does
// NOT match embed (`/maps/embed?pb=…`) URLs, so parse them here (Asunción lesson).
const EMBED_COORDS_RE = /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/;
// Field separators for a single-line, dash-joined run: em/en dash, pipe, bullet,
// middot (char class) plus a space-padded hyphen (string). A BARE hyphen is
// excluded so ISO dates ("2026-06-20") stay intact. Normalize-then-split keeps
// it linear — a `\s*[…]\s*|\s+-\s+` alternation backtracks super-linearly (S8786).
const SEGMENT_SEPARATORS_RE = /[—–|•·]/g;
const SPACED_HYPHEN = " - ";

// Sri Lanka bounding box — reject a default/garbage embed pin (lat ~5.9–9.9 N,
// lng ~79.6–81.9 E) before trusting per-event coords.
const LK_LAT_MIN = 5.7;
const LK_LAT_MAX = 10;
const LK_LNG_MIN = 79.5;
const LK_LNG_MAX = 82;

/** Collapsed (single-spaced, lowercased) copy of a string. */
function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Whole-token month detection via the shared MONTHS record (keys include both
 * "jun" and "june"). Whole-token membership avoids the prefix trap a month regex
 * has — "Junction"/"Marina" are NOT months, but `\bmar[a-z]*\b` would match them.
 */
function hasMonthToken(line: string): boolean {
  return line
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((token) => token !== "" && Object.hasOwn(MONTHS, token));
}

/** Split a line into per-field segments (handles single-line, dash-joined runs). */
function splitSegments(line: string): string[] {
  // Two linear passes (string split on " - ", then char-class split) — no
  // quantifier-adjacent alternation, so no super-linear backtracking (S8786).
  return line
    .split(SPACED_HYPHEN)
    .flatMap((part) => part.split(SEGMENT_SEPARATORS_RE))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * A line that looks like a run date (ISO, or a worded date with a month + digit).
 * Street lines are excluded first so an address carrying a month name ("12 May
 * Road", "June Street") is never mistaken for the date (Gemini review).
 */
function isDateLine(line: string): boolean {
  if (STREET_HINT_RE.test(line)) return false;
  if (ISO_DATE_RE.test(line)) return true;
  return hasMonthToken(line) && /\d/.test(line);
}

/** First start time in the block: 12-hour ("5:00 PM") preferred, then 24-hour ("17:00"). */
function parseStartTime(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = TIME_12H_RE.exec(line);
    if (!m) continue;
    let hour = Number.parseInt(m[1], 10);
    const minute = m[2] ?? "00";
    const meridiem = m[3].toLowerCase();
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:${minute}`;
  }
  for (const line of lines) {
    const m = TIME_24H_RE.exec(line);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return undefined;
}

/**
 * Best-effort venue/street split from the leftover content lines (everything
 * that is not the date line, the run-number header, or a bare time). A line with
 * a comma or a street keyword → `locationStreet`; the first plain line → venue.
 * Enrichment only (never affects date correctness); refine once the real filled
 * DOM is observed.
 */
function parseVenue(
  lines: string[],
  dateLine: string | undefined,
): { location?: string; locationStreet?: string } {
  let location: string | undefined;
  let locationStreet: string | undefined;
  for (const line of lines) {
    if (line === dateLine) continue;
    if (RUN_NUMBER_RE.test(line)) continue;
    if (TIME_ONLY_RE.test(line.replace(/\s+/g, ""))) continue;
    if (line.includes(",") || STREET_HINT_RE.test(line)) {
      locationStreet ??= line;
    } else {
      location ??= line;
    }
  }
  return { location, locationStreet };
}

/** First Google Maps embed iframe → URL + (LK-bounded) coords. */
function extractEmbedCoords(
  $: cheerio.CheerioAPI,
): { url: string; lat?: number; lng?: number } | undefined {
  const src = $("iframe")
    .toArray()
    .map((el) => $(el).attr("src") ?? "")
    .find((s) => /google\.com\/maps\/embed/i.test(s));
  if (!src) return undefined;
  const m = EMBED_COORDS_RE.exec(src);
  if (!m) return { url: src };
  const lng = Number.parseFloat(m[1]);
  const lat = Number.parseFloat(m[2]);
  if (lat >= LK_LAT_MIN && lat <= LK_LAT_MAX && lng >= LK_LNG_MIN && lng <= LK_LNG_MAX) {
    return { url: src, lat, lng };
  }
  return { url: src };
}

/**
 * Parse the Colombo Harriettes home page into RawEvents. Three outcomes:
 *  - placeholder ("We will announce soon")  → `{ events: [], errors: [] }` (clean)
 *  - a parseable run                        → `{ events: [event], errors: [] }`
 *  - heading missing / unrecognized / a run
 *    block that won't fully parse           → `{ events: [], errors: [msg] }` (loud)
 */
export function parseColomboHarriettesPage(
  html: string,
  sourceUrl: string,
  now: Date = new Date(),
): { events: RawEventData[]; errors: string[] } {
  const $ = cheerio.load(html);

  const headingEl = $("p")
    .toArray()
    .find((el) => collapse($(el).text()) === "next run");
  if (!headingEl) {
    return {
      events: [],
      errors: ["Colombo Harriettes: 'Next run' heading not found — markup drift"],
    };
  }

  // The heading <p> and the run/placeholder <p> share an immediate parent <div>,
  // which bounds the block exactly — no fragile boundary guessing needed.
  const blockLines = stripHtmlTags($(headingEl).parent().html() ?? "", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => collapse(line) !== "next run");

  // Split each line on dash/pipe/bullet separators so a single-line, dash-joined
  // run ("Run #2223 — 2026-06-20 — KK's Crib — 17:00 — No.5, …") yields the same
  // per-field segments as a multi-<p> render. Without this, the whole line became
  // `dateLine` and `parseVenue` skipped it, dropping venue/street (Codex review).
  const segments = blockLines.flatMap(splitSegments);

  const collapsed = collapse(segments.join(" "));

  // (1) Between-postings placeholder → clean empty.
  if (PLACEHOLDER_RE.test(collapsed)) {
    return { events: [], errors: [] };
  }

  const runMatch = RUN_NUMBER_RE.exec(collapsed);
  const dateLine = segments.find(isDateLine);

  // (3b) Neither the placeholder nor any run signal → reworded placeholder or drift.
  if (!runMatch && !dateLine) {
    return {
      events: [],
      errors: [
        "Colombo Harriettes: 'Next run' block is neither the known placeholder nor a parseable run — markup may have changed",
      ],
    };
  }

  // Dates carry a year (no inference); a year-less date rolls forward from today.
  const date = dateLine ? chronoParseDate(dateLine, "en-GB", now, { forwardDate: true }) : null;

  // (3a) A run is clearly present but the date won't parse → fail loud (no guessing).
  if (!date) {
    return {
      events: [],
      errors: [
        `Colombo Harriettes: run block found (run #${runMatch?.[1] ?? "?"}) but could not parse a date — verify the live markup`,
      ],
    };
  }

  const { location, locationStreet } = parseVenue(segments, dateLine);
  const coords = extractEmbedCoords($);

  const event: RawEventData = {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: runMatch ? Number.parseInt(runMatch[1], 10) : undefined,
    // title intentionally undefined → merge.ts synthesizes "Colombo Harriettes Trail #N".
    // hares not seen in the documented sample; never synthesize from venue/run.
    location,
    locationStreet,
    locationUrl: coords?.url,
    latitude: coords?.lat,
    longitude: coords?.lng,
    startTime: parseStartTime(segments),
    sourceUrl,
  };

  return { events: [event], errors: [] };
}

/**
 * Colombo Hash House Harriettes HTML Scraper.
 *
 * Fetches the static Next.js home page (plain Cheerio — SSR confirmed, no browser
 * render). `options.days` is ignored: the page renders exactly one current run
 * (or the placeholder) with no date range to filter. Fingerprint dedup handles
 * repeat scrapes between updates.
 */
export class ColomboHarriettesAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { events, errors } = parseColomboHarriettesPage(html, url);

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: { eventsParsed: events.length, fetchDurationMs },
    };
  }
}
