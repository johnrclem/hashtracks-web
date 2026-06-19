/**
 * Phnom Penh Hash House Harriers (P2H3) HTML Scraper — first 🇰🇭 Cambodia kennel.
 *
 * Scrapes p2h3.com, a fully server-rendered Grav CMS site. Two surfaces:
 *
 *   1. Home page (`/`)  — the authoritative forward feed. Grav renders two
 *      markdown pipe-tables into real `<table>`s ("This week's Hash" = the
 *      richest current row, "Upcoming Hashes" = the next ~5, mostly TBC). Shared
 *      column shape:  Number | Date(DD.MM.YYYY) | By | Hares | A-Site | B-Site | Remarks
 *      The current run's Number cell links to its `/news/<n>` detail page.
 *
 *   2. `/news/<n>` detail — per-run enrichment (venue name + its Maps link,
 *      departure time, distances, hares). Only the current run links to a detail
 *      page on the forward feed, so live enrichment is ~1 extra fetch. The same
 *      per-post parser backfills recent history (#1829–#1840) via a one-shot
 *      script.
 *
 * Both date formats are year-bearing (no inference): home tables use
 * `DD.MM.YYYY`; `/news` uses `Sunday 21st June 2026`. Venue links are
 * `maps.app.goo.gl` shortlinks with no extractable coordinates, so they are
 * stored as `locationUrl` only and the merge pipeline geocodes the venue text /
 * Phnom Penh centroid. Titles are left undefined → merge synthesizes
 * "Phnom Penh H3 Trail #N".
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ParseError,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  fetchHTMLPage,
  filterEventsByWindow,
  chronoParseDate,
  stripZeroWidth,
} from "../utils";

const KENNEL_TAG = "phnom-penh-h3";
const DEFAULT_URL = "https://www.p2h3.com/";
/** FAQ: the country bus leaves Villa Grange promptly at 1:30 pm every Sunday. */
const DEFAULT_START_TIME = "13:30";
/**
 * Cap `/news` enrichment fetches per scrape. Only the current run links to a
 * detail page today, but bound the request count defensively in case the site
 * later links every upcoming row.
 */
const MAX_ENRICH = 3;

const KM_TO_MILES = 0.621371;

// Maps links are validated against an https + host allowlist (mirrors
// kaohsiung-hash.ts; Codacy flags unvalidated variable URLs).
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);

// Placeholder cell values the source uses for "not yet decided". A Set lookup on
// the normalized (lower-cased, whitespace-collapsed) value avoids a regex
// alternation entirely (no Sonar S5852/S5843 backtracking concern).
const PLACEHOLDER_VALUES = new Set([
  "tbc", "tba", "tbd", "n/a", "/n/a",
  "hare needed", "hare needed!", "hares needed", "hares needed!",
]);

function isPlaceholder(normalized: string): boolean {
  return PLACEHOLDER_VALUES.has(normalized.toLowerCase());
}

// Home table date: DD.MM.YYYY (dots).
const HOME_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
// Run-number-shaped first cell ("1841"). Decorative rows are skipped.
const RUN_CELL_RE = /^\d{2,5}$/;
// /news link in the Number cell.
const NEWS_LINK_RE = /\/news\/\d+/;
// "...meeting at 13.15 for 13.30 departure" → capture the departure clock.
const DEPARTURE_RE = /\bfor (\d{1,2})[.:](\d{2}) departure\b/i;
// "5km" / "10 km" / "6.2km". Digit counts are bounded ({1,4} / {1,2}) so the
// match stays strictly linear — no super-linear backtracking (Sonar S5852).
const KM_RE = /(\d{1,4}(?:\.\d{1,2})?)\s?km\b/i;
// Strip an ordinal suffix from a day number ("21st" → "21").
const ORDINAL_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/gi;
// Separators that follow a field label ("Location:", "Date/Time:-", "Run No.").
const LABEL_SEP_RE = /^[\s:.-]+/;

function normalizeText(raw: string): string {
  return stripZeroWidth(raw).replaceAll(/\s+/g, " ").trim();
}

function isValidMapsUrl(href: string): boolean {
  try {
    // Resolve against the source origin so protocol-relative ("//maps.app.goo.gl")
    // and relative hrefs don't throw; non-Maps hosts still fail the allowlist.
    const parsed = new URL(href, DEFAULT_URL);
    return parsed.protocol === "https:" && MAPS_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Tri-state cell cleaner for per-event text fields (hares, remarks):
 *   - `undefined` arg (cell absent)         → undefined (merge preserves existing)
 *   - present placeholder / empty cell      → null (merge explicitly clears)
 *   - real value                            → the trimmed value
 * Returning `null` (not `undefined`) for a present placeholder is what lets a
 * run that flips from a real hare back to "Hares Needed!"/"TBC" clear the stale
 * value through the merge pipeline (atomic-bundle semantics).
 */
function cleanField(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const v = normalizeText(value);
  if (!v || isPlaceholder(v)) return null;
  return v;
}

/**
 * If `text` starts with `label` (case-insensitive), return the remainder with
 * leading separators stripped. Uses string ops for the prefix match (Codacy /
 * Sonar prefer this over a `^label\s*:?\s*` regex with `\s*`-adjacent capture).
 */
function stripLabel(text: string, label: string): string | undefined {
  if (text.length < label.length) return undefined;
  if (text.slice(0, label.length).toLowerCase() !== label.toLowerCase()) return undefined;
  const rest = text.slice(label.length).replace(LABEL_SEP_RE, "").trim();
  return rest || undefined;
}

/** Parse a home-table `DD.MM.YYYY` cell to a UTC-noon `YYYY-MM-DD` string. */
export function parseHomeDate(text: string): string | null {
  const m = HOME_DATE_RE.exec(text.trim());
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Reject overflow (e.g. 31.02.2026 → March).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Parse a `/news` `Sunday 21st June 2026` heading to `YYYY-MM-DD` (year-bearing). */
export function parseNewsDate(text: string): string | null {
  // Strip the ordinal suffix so chrono reads a clean "21 June 2026"; the leading
  // weekday word is ignored by chrono. Full month name + 4-digit year is
  // unambiguous, so no year inference and no "D MMM YY" pitfall.
  const cleaned = text.replace(ORDINAL_RE, "$1").replaceAll(/\s+/g, " ").trim();
  // Require an explicit 4-digit year — fail loud rather than let chrono infer a
  // missing year (which would silently produce a wrong date if the source drops it).
  if (!/\b\d{4}\b/.test(cleaned)) return null;
  return chronoParseDate(cleaned, "en-GB");
}

function kmToMiles(km: number): number {
  return Math.round(km * KM_TO_MILES * 100) / 100;
}

function parseKm(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = KM_RE.exec(value);
  if (!m) return undefined;
  const km = Number.parseFloat(m[1]);
  return Number.isFinite(km) && km > 0 ? km : undefined;
}

/**
 * Parse a single home-table row into a RawEventData (without enrichment).
 * Returns null for header/decorative rows or an unparseable date. Exported for
 * unit testing.
 *
 * Columns: [0]=Number(/news link) [1]=Date [2]=By [3]=Hares [4]=A-Site [5]=B-Site [6]=Remarks
 */
export function parseHomeRow(
  cells: string[],
  hrefs: (string | undefined)[],
  baseUrl: string,
): RawEventData | null {
  if (cells.length < 4) return null;

  const firstCell = cells[0]?.trim() ?? "";
  if (!RUN_CELL_RE.test(firstCell)) return null;
  const runNumber = Number.parseInt(firstCell, 10);

  const date = parseHomeDate(cells[1] ?? "");
  if (!date) return null;

  // The "By" column (cells[2]) is a logistics note ("Bus" = country-bus run,
  // "TBC"), NOT a hare — intentionally ignored.
  const hares = cleanField(cells[3]);

  // A-Site Google Maps link → locationUrl. Shortlinks carry no decimal coords,
  // so latitude/longitude stay undefined and the merge pipeline geocodes.
  const aSiteHref = hrefs[4];
  const locationUrl = aSiteHref && isValidMapsUrl(aSiteHref) ? aSiteHref : undefined;

  const description = cleanField(cells[6]);

  // The Number cell links to /news/<n> only for the current run; resolve it as
  // this event's source URL when present.
  const detailHref = hrefs[0];
  const sourceUrl = detailHref ? new URL(detailHref, baseUrl).href : baseUrl;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares,
    locationUrl,
    startTime: DEFAULT_START_TIME,
    description,
    sourceUrl,
  };
}

export interface NewsDetail {
  runNumber?: number;
  date?: string;
  startTime?: string;
  location?: string;
  locationUrl?: string;
  hares?: string | null;
  trailLengthText?: string;
  trailLengthMinMiles?: number;
  trailLengthMaxMiles?: number;
  onOn?: string;
}

/** First valid Maps href inside an element (per-block, so the right link binds to the right label). */
function firstMapsHref($: CheerioAPI, el: Element): string | undefined {
  let found: string | undefined;
  $(el)
    .find("a")
    .each((_i, a) => {
      if (found) return;
      const href = $(a).attr("href")?.trim();
      if (href && isValidMapsUrl(href)) found = href;
    });
  return found;
}

/** Parse a "...for 13.30 departure" clause into an "HH:MM" start time. */
function parseDeparture(text: string): string | undefined {
  const dm = DEPARTURE_RE.exec(text);
  if (!dm) return undefined;
  const h = Number.parseInt(dm[1], 10);
  const min = Number.parseInt(dm[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${dm[2]}`;
}

/** Mutable accumulator threaded through the label handlers. */
interface NewsParseCtx {
  detail: NewsDetail;
  walkKm?: number;
  runKm?: number;
}

type LabelHandler = (rest: string, ctx: NewsParseCtx, $: CheerioAPI, el: Element) => void;

// Ordered label → handler dispatch. The loop in parseNewsDetail tries each label
// against the paragraph text and runs the first match, keeping the parse body
// flat (one match → one tiny handler) instead of a deeply-nested if-chain.
const NEWS_LABEL_HANDLERS: ReadonlyArray<readonly [string, LabelHandler]> = [
  ["Run No", (rest, ctx) => {
    const n = Number.parseInt(rest, 10);
    if (!Number.isNaN(n)) ctx.detail.runNumber = n;
  }],
  ["Date/Time", (rest, ctx) => { ctx.detail.date = parseNewsDate(rest) ?? undefined; }],
  ["Meeting Point", (rest, ctx) => {
    const t = parseDeparture(rest);
    if (t) ctx.detail.startTime = t;
  }],
  ["Location", (rest, ctx, $, el) => {
    ctx.detail.location = rest;
    ctx.detail.locationUrl = firstMapsHref($, el);
  }],
  ["Walking", (rest, ctx) => { ctx.walkKm = parseKm(rest); }],
  ["Running", (rest, ctx) => { ctx.runKm = parseKm(rest); }],
  ["On On", (rest, ctx) => { ctx.detail.onOn = rest; }],
  ["Hares", (rest, ctx) => { ctx.detail.hares = cleanField(rest); }],
];

/** Compose trailLengthText + min/max miles from the accumulated walk/run km. */
function applyTrailLength(ctx: NewsParseCtx): void {
  const { walkKm, runKm, detail } = ctx;
  if (walkKm === undefined && runKm === undefined) return;
  const parts: string[] = [];
  if (runKm !== undefined) parts.push(`${runKm} km run`);
  if (walkKm !== undefined) parts.push(`${walkKm} km walk`);
  detail.trailLengthText = parts.join(" / ");
  const miles = [walkKm, runKm].filter((v): v is number => v !== undefined).map(kmToMiles);
  detail.trailLengthMinMiles = Math.min(...miles);
  detail.trailLengthMaxMiles = Math.max(...miles);
}

/**
 * Parse a `/news/<n>` detail page. Grav renders the post body as a sequence of
 * `<p>` blocks (some nested in `<ul><li>`) inside `#body-wrapper`, each a
 * labeled field ("Run No.", "Date/Time:-", "Meeting Point:", "Location:",
 * "Walking :", "Running :", "On On:", "Hares:"). The Maps link bound to each
 * label is the anchor inside that same `<p>`. Exported for enrichment + backfill.
 */
export function parseNewsDetail(html: string): NewsDetail {
  const $ = cheerio.load(html);
  const ctx: NewsParseCtx = { detail: {} };

  $("#body-wrapper p").each((_i, el) => {
    const text = normalizeText($(el).text());
    if (!text) return;
    for (const [label, handler] of NEWS_LABEL_HANDLERS) {
      const rest = stripLabel(text, label);
      if (rest !== undefined) {
        handler(rest, ctx, $, el);
        return;
      }
    }
  });

  applyTrailLength(ctx);
  return ctx.detail;
}

/** Build a full RawEventData from a `/news` detail (used by the history backfill). */
export function newsDetailToRawEvent(detail: NewsDetail, sourceUrl: string): RawEventData | null {
  if (detail.runNumber === undefined || !detail.date) return null;
  return {
    date: detail.date,
    kennelTags: [KENNEL_TAG],
    runNumber: detail.runNumber,
    hares: detail.hares,
    location: detail.location,
    locationUrl: detail.locationUrl,
    startTime: detail.startTime ?? DEFAULT_START_TIME,
    trailLengthText: detail.trailLengthText,
    trailLengthMinMiles: detail.trailLengthMinMiles,
    trailLengthMaxMiles: detail.trailLengthMaxMiles,
    description: detail.onOn ? `On On: ${detail.onOn}` : undefined,
    sourceUrl,
  };
}

/** Overlay the richer `/news` detail fields onto a home-table backbone event (keeps the home date). */
function mergeDetail(event: RawEventData, detail: NewsDetail): void {
  if (detail.location) event.location = detail.location;
  if (detail.locationUrl) event.locationUrl = detail.locationUrl;
  if (detail.startTime) event.startTime = detail.startTime;
  // hares is tri-state (null = explicit clear); propagate any present signal so
  // a real→placeholder transition still clears the stale value.
  if (detail.hares !== undefined) event.hares = detail.hares;
  // Surface the On-On venue only when the home Remarks didn't already provide a
  // description (the Remarks column, when present, is richer than the venue name).
  if (detail.onOn && !event.description) event.description = `On On: ${detail.onOn}`;
  if (detail.trailLengthText) {
    event.trailLengthText = detail.trailLengthText;
    event.trailLengthMinMiles = detail.trailLengthMinMiles;
    event.trailLengthMaxMiles = detail.trailLengthMaxMiles;
  }
}

export class PhnomPenhH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const enrichTargets: { event: RawEventData; newsUrl: string }[] = [];
    const parseErrors: ParseError[] = [];
    const errorDetails: ErrorDetails = {};

    const rows = $("table tr");
    rows.each((i, el) => {
      const $row = $(el);
      if ($row.find("th").length > 0) return; // skip header rows

      const cells: string[] = [];
      const hrefs: (string | undefined)[] = [];
      $row.find("td").each((_j, td) => {
        const $td = $(td);
        $td.find("br").replaceWith(" ");
        cells.push($td.text().trim());
        hrefs.push($td.find("a").first().attr("href") || undefined);
      });

      const firstCell = cells[0]?.trim() ?? "";
      if (!RUN_CELL_RE.test(firstCell)) return; // decorative / non-run row

      try {
        const event = parseHomeRow(cells, hrefs, baseUrl);
        if (!event) {
          // A numbered run row whose date no longer parses is markup drift, not
          // a legitimately-absent run. Record a parse error so fetch() surfaces
          // it and reconcile is suppressed (don't false-CANCEL a run the page
          // still lists). Mirrors the Kaohsiung per-run fail-loud pattern.
          parseErrors.push({
            row: i,
            section: "hareline",
            field: "date",
            error: `Phnom Penh H3: could not parse run row "${firstCell}"`,
            rawText: $row.text().trim().slice(0, 200),
          });
          return;
        }
        events.push(event);
        const detailHref = hrefs[0];
        if (detailHref && NEWS_LINK_RE.test(detailHref)) {
          enrichTargets.push({ event, newsUrl: new URL(detailHref, baseUrl).href });
        }
      } catch (err) {
        parseErrors.push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: $row.text().trim().slice(0, 200),
        });
      }
    });

    // Enrich the current (+ next, if linked) runs from their /news detail pages.
    // Enrichment is best-effort augmentation: a failed detail fetch is recorded
    // but does NOT block reconcile — the backbone run already exists from the
    // home table, so a missing enrichment can never false-CANCEL it.
    for (const target of enrichTargets.slice(0, MAX_ENRICH)) {
      const detailPage = await fetchHTMLPage(target.newsUrl);
      if (!detailPage.ok) {
        errorDetails.fetch ??= [];
        errorDetails.fetch.push({ url: target.newsUrl, message: "news detail fetch failed" });
        continue;
      }
      mergeDetail(target.event, parseNewsDetail(detailPage.html));
    }

    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    // Fail-loud: a single forward feed with a 0-event baseline can't rely on the
    // zero-event health alert. Per-run drift (above) + a fully-empty result both
    // surface as errors[] so scrape.ts suppresses stale reconciliation.
    const errors: string[] = parseErrors.map((p) => p.error);
    if (windowed.length === 0) {
      errors.push(
        `Phnom Penh H3: no upcoming runs from ${baseUrl} ` +
          `(${events.length} parsed, ${rows.length} rows)`,
      );
    }

    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events: windowed,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: windowed.length,
        totalBeforeFilter: events.length,
        enriched: Math.min(enrichTargets.length, MAX_ENRICH),
        fetchDurationMs,
      },
    };
  }
}
