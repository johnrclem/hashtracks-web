import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  decodeEntities,
  MONTHS,
  stripPlaceholder,
  validateSourceConfig,
} from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

const DEFAULT_BASE = "https://indyhhh.com";
const DEFAULT_PAGE_ID = 1792; // "Upcumming Hashes" WordPress page
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/** How many detail pages to fetch in parallel (issue #1302). */
const DETAIL_FETCH_CONCURRENCY = 5;

/** Source config for IndyScent adapter. */
interface IndyH3Config {
  /** Base site URL (default: https://indyhhh.com). */
  baseUrl?: string;
  /** WordPress page ID hosting the Upcumming Hashes blocks (default: 1792). */
  pageId?: number;
  /** [[regex, kennelTag], ...] — first match wins. Used to route events to THICC. */
  kennelPatterns?: [string, string][];
  /** Fallback kennel tag when no pattern matches. */
  defaultKennelTag: string;
}

function matchKennelTag(
  title: string,
  compiled: [RegExp, string][],
  defaultTag: string,
): string {
  for (const [re, tag] of compiled) {
    if (re.test(title)) return tag;
  }
  return defaultTag;
}

/**
 * Parse a human date like "Friday, April 10, 2026" into "YYYY-MM-DD".
 * Returns null on unknown formats.
 */
export function parseIndyDate(raw: string): string | null {
  const cleaned = raw.replaceAll("\u00a0", " ").trim();
  // Pattern: "Friday, April 10, 2026" — day-of-week optional
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(cleaned);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a human time like "5:00 PM" or "7 PM" into "HH:MM" (24-hour).
 * Returns null on unknown formats.
 */
export function parseIndyTime(raw: string): string | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(raw.trim());
  if (!m) return null;
  let hour = Number.parseInt(m[1], 10);
  const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse one ht-upcoming-card block into a RawEventData.
 * Returns null if required fields (date, title) are missing.
 */
export function parseIndyCard(
  $card: cheerio.Cheerio<never>,
  $: cheerio.CheerioAPI,
  compiledPatterns: [RegExp, string][],
  defaultTag: string,
  sourceUrl: string,
): RawEventData | null {
  // Title: "Hash #1119: IndyScent Prom - Spy vs Spy 2026 - Initial Contact"
  const h3 = $card.find("h3").first().text().trim();
  if (!h3) return null;
  const runMatch = /Hash\s*#?(\d+)\s*:\s*(.+)/i.exec(h3);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;
  const title = decodeEntities((runMatch ? runMatch[2] : h3).trim());

  // Extract label:value pairs. Labels are inside <strong> tags preceded by an
  // emoji; the value is whatever follows "Label:" in the containing <div>.
  // We match anywhere in the text so the emoji prefix doesn't throw off the slice.
  const getField = (labelRegex: RegExp): string | undefined => {
    let value: string | undefined;
    $card.find("div").each((_i, el) => {
      const text = $(el).text().trim();
      const match = labelRegex.exec(text);
      if (match?.[1]) {
        value = match[1].trim();
        return false; // stop on first match
      }
    });
    return value;
  };

  const dateRaw = getField(/Date:\s*(.+)/i);
  const timeRaw = getField(/Time:\s*(.+)/i);
  const haresRaw = getField(/Hares?:\s*(.+)/i);
  const locationRaw = getField(/(?:Location|Start|Where):\s*(.+)/i);

  if (!dateRaw) return null;
  const date = parseIndyDate(dateRaw);
  if (!date) return null;

  const startTime = timeRaw ? parseIndyTime(timeRaw) ?? undefined : undefined;
  const hares = stripPlaceholder(haresRaw);
  const location = stripPlaceholder(locationRaw);

  // Detail link for sourceUrl
  const detailHref = $card.find("a[href]").first().attr("href")?.trim();

  const kennelTag = matchKennelTag(title, compiledPatterns, defaultTag);

  return {
    date,
    kennelTags: [kennelTag],    runNumber,
    title,
    hares,
    location,
    startTime,
    sourceUrl: detailHref || sourceUrl,
  };
}

/**
 * Parse a `/hashes/<slug>/` IndyScent detail page.
 *
 * The list page (Upcumming Hashes) does not include the start location — it
 * only lives on the per-hash detail page, where IndyScent uses two label
 * conventions:
 *
 *   - Finalized / past events:  `<strong>Start Location:</strong> Gravel lot ...`
 *   - Pre-posted upcoming runs: `<strong>Where?</strong> Leonard Park ...`
 *
 * The `<strong>Start Location:</strong>` label also appears earlier in the
 * page as an empty section heading (no text node follows it). To handle all
 * three cases we walk every `<strong>`, match against the labels in priority
 * order, and pick the first whose adjacent text node is a non-placeholder.
 *
 * Returns `{}` when no usable location is found (caller keeps list-page data).
 *
 * Exported for unit testing.
 */
// Drop the bare "Start" arm — `<strong>Start:</strong> 3:00 PM` is a start
// time on some detail pages, not a location (Codex review on PR #1335).
const LOCATION_LABEL_RE = /^(?:Start\s+Location|Where)\s*[?:]?$/i;

// #1354 detail-fold helpers. The detail page (X/Cornerstone theme) carries a
// rich event body — narrative blurb, "What?/When?/Who?/How?/Where?" fields, and
// an "ON-AFTER!" section — none of which the list page exposes. We fold that body
// into `description` (duplicate of list-page date/hares is acceptable — preserve
// the source's look/feel) and only lift a clean mileage token into the typed
// trail-length bundle. The jokey "Shiggy"/dog-status content stays in the
// description rather than being forced into the difficulty/dogFriendly columns.
const DETAIL_TITLE_LINE_RE = /^Hash\s*#?\d+\s*:/i; // list-page title echo
const DETAIL_META_EMOJI_RE = /^(?:📅|⏰|🐇|🗺️)/; // Date/Time/Hares/Directions rows
const DETAIL_START_LOCATION_LABEL_RE = /^Start\s+Location:?$/i; // empty label row
const DETAIL_CHROME_LINE_RE = /^(?:share|add to calendar|get directions)$/i;

// Plausible trail-length tokens embedded in prose ("~3.69mi", "3 miles",
// "3-5 miles"). Single `\s*` runs, no alternation-adjacent quantifiers (Sonar).
const TRAIL_MILEAGE_RANGE_RE = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*mi(?:le|les)?\b/i;
const TRAIL_MILEAGE_RE = /~?(\d+(?:\.\d+)?)\s*mi(?:le|les)?\b/i;

/** Lift the rich detail-page body into a folded description, excluding the
 *  list-page title echo, emoji metadata rows, the empty "Start Location:" label,
 *  the byline (the only `<p>`), and action chrome (Get Directions / Add to
 *  Calendar / Share). Returns undefined for skeleton events with no body. */
function extractIndyDescription($: cheerio.CheerioAPI): string | undefined {
  const $scope = $(".ht_hash_event").first();
  const scope = $scope.length ? $scope : $("body");
  // cheerio's .text() includes <script>/<style> bodies (the X theme inlines a
  // Sharrre share widget + a Leaflet map init), so strip them first or the
  // description fills with JavaScript. Then surgically drop the byline
  // ("by <author> · <date>") — only `<p>`s that start with "by", so content
  // `<p>` blocks (the older layout puts Trail/Shiggy lines in a `<p>`) survive —
  // and the action links (Get Directions / Add to Calendar / Share).
  scope.find("script, style, noscript").remove();
  scope.find("p").each((_i, el) => {
    if (/^\s*by\b/i.test($(el).text())) $(el).remove();
  });
  scope.find("a, button").each((_i, el) => {
    if (/get directions|add to calendar|share/i.test($(el).text())) $(el).remove();
  });
  const withBreaks = (scope.html() ?? "").replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, "\n");
  const lines = cheerio
    .load(withBreaks)
    .root()
    .text()
    .split("\n")
    .map((l) => decodeEntities(l).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !DETAIL_TITLE_LINE_RE.test(l) &&
        !DETAIL_META_EMOJI_RE.test(l) &&
        !DETAIL_START_LOCATION_LABEL_RE.test(l) &&
        !DETAIL_CHROME_LINE_RE.test(l),
    );
  const desc = lines.join("\n").trim();
  return desc || undefined;
}

/** Extract a plausible trail length (1–15 mi) from the detail body. Returns the
 *  verbatim token plus parsed min/max (equal for a fixed distance). No token →
 *  empty object (merge preserves any existing value). */
function extractIndyTrailLength(
  text: string,
): { trailLengthText?: string; trailLengthMinMiles?: number; trailLengthMaxMiles?: number } {
  const range = TRAIL_MILEAGE_RANGE_RE.exec(text);
  if (range) {
    const min = Number.parseFloat(range[1]);
    const max = Number.parseFloat(range[2]);
    if (min >= 1 && max <= 15 && min <= max) {
      return { trailLengthText: range[0].trim(), trailLengthMinMiles: min, trailLengthMaxMiles: max };
    }
  }
  const fixed = TRAIL_MILEAGE_RE.exec(text);
  if (fixed) {
    const n = Number.parseFloat(fixed[1]);
    if (n >= 1 && n <= 15) {
      return { trailLengthText: fixed[0].trim(), trailLengthMinMiles: n, trailLengthMaxMiles: n };
    }
  }
  return {};
}

export interface IndyDetail {
  location?: string;
  description?: string;
  trailLengthText?: string;
  trailLengthMinMiles?: number;
  trailLengthMaxMiles?: number;
}

export function parseIndyDetail(html: string): IndyDetail {
  const $ = cheerio.load(html);
  let preferred: string | undefined; // value behind "Start Location" — wins
  let fallback: string | undefined; // value behind "Where?"

  $("strong").each((_i, el) => {
    if (preferred) return false;
    const labelText = $(el).text().trim();
    if (!LOCATION_LABEL_RE.test(labelText)) return;
    const next = el.nextSibling;
    if (next?.type !== "text") return;
    const candidate = stripPlaceholder(decodeEntities(next.data ?? ""));
    if (!candidate) return;
    if (/^Start\s+Location/i.test(labelText)) {
      preferred = candidate;
      return false;
    } else if (!fallback) {
      fallback = candidate;
    }
  });

  const description = extractIndyDescription($);
  const trail = description ? extractIndyTrailLength(description) : {};

  return { location: preferred ?? fallback, description, ...trail };
}

async function fetchDetailHtml(
  url: string,
): Promise<{ ok: true; html: string } | { ok: false; status: number }> {
  const res = await safeFetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, html: await res.text() };
}

async function enrichWithDetails(
  detailEnrichable: RawEventData[],
  errors: string[],
  errorDetails: ErrorDetails,
): Promise<{ fetched: number; enriched: number }> {
  let fetched = 0;
  let enriched = 0;
  for (let i = 0; i < detailEnrichable.length; i += DETAIL_FETCH_CONCURRENCY) {
    const batch = detailEnrichable.slice(i, i + DETAIL_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((event) => fetchDetailHtml(event.sourceUrl as string)),
    );
    settled.forEach((r, j) => {
      const event = batch[j];
      const url = event.sourceUrl as string;
      if (r.status === "rejected") {
        errors.push(`Detail fetch failed for ${url}: ${r.reason}`);
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url, message: String(r.reason) },
        ];
        return;
      }
      fetched++;
      if (!r.value.ok) {
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url, status: r.value.status, message: `HTTP ${r.value.status}` },
        ];
        return;
      }
      try {
        const detail = parseIndyDetail(r.value.html);
        let didEnrich = false;
        // Only fill location when the list page didn't supply one (don't clobber).
        if (detail.location && !event.location) {
          event.location = detail.location;
          didEnrich = true;
        }
        // Fold the rich detail body into description (#1354). List page carries
        // no description, so this is fill-only.
        if (detail.description && !event.description) {
          event.description = detail.description;
          didEnrich = true;
        }
        // Lift a clean mileage token into the typed trail-length bundle (#1354).
        if (detail.trailLengthText) {
          event.trailLengthText = detail.trailLengthText;
          event.trailLengthMinMiles = detail.trailLengthMinMiles;
          event.trailLengthMaxMiles = detail.trailLengthMaxMiles;
          didEnrich = true;
        }
        if (didEnrich) enriched++;
      } catch (err) {
        errors.push(`Detail parse error for ${url}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: 0, section: url, error: String(err) },
        ];
      }
    });
  }
  return { fetched, enriched };
}

/**
 * IndyScent H3 (Indianapolis) adapter.
 *
 * Fetches the "Upcumming Hashes" WordPress page (default id 1792) and parses
 * the `.ht-upcoming-card` blocks. The same page aggregates THICC H3 events;
 * `kennelPatterns` can route those to the `thicch3` kennel.
 *
 * After list-page parsing, follows each card's `/hashes/` detail URL (capped
 * concurrency) to extract the start location, which the list page omits
 * (issue #1302).
 */
export class IndyH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<IndyH3Config>(source.config, "IndyH3Adapter", {
      defaultKennelTag: "string",
    });

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    const pageId = config.pageId ?? DEFAULT_PAGE_ID;
    const apiUrl = `${baseUrl}/wp-json/wp/v2/pages/${pageId}`;

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let json: { content?: { rendered?: string } };
    try {
      const res = await safeFetch(apiUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        errorDetails.fetch = [{ url: apiUrl, status: res.status, message: `HTTP ${res.status}` }];
        return { events: [], errors: [`WordPress API fetch failed: HTTP ${res.status}`], errorDetails };
      }
      json = (await res.json()) as { content?: { rendered?: string } };
    } catch (err) {
      const msg = `WordPress API fetch error: ${err instanceof Error ? err.message : String(err)}`;
      errorDetails.fetch = [{ url: apiUrl, message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    const html = json.content?.rendered ?? "";
    if (!html) {
      errors.push("Empty content.rendered from WordPress page");
      return { events: [], errors };
    }

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // Zip-safe compile: keep each pattern paired with its tag even if some
    // regexes are malformed. Using compilePatterns() + index mapping risks
    // desync when a pattern fails to compile.
    const compiled: [RegExp, string][] = (config.kennelPatterns ?? []).flatMap(
      ([pattern, tag]) => {
        try {
          return [[new RegExp(pattern, "im"), tag] as [RegExp, string]];
        } catch {
          return [];
        }
      },
    );

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    const rawEvents: RawEventData[] = [];
    let cardIndex = 0;
    $(".ht-upcoming-card").each((_i, el) => {
      cardIndex++;
      try {
        const event = parseIndyCard(
          $(el) as cheerio.Cheerio<never>,
          $,
          compiled,
          config.defaultKennelTag,
          baseUrl,
        );
        if (event) rawEvents.push(event);
      } catch (err) {
        errors.push(`Error parsing card ${cardIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: cardIndex, error: String(err) },
        ];
      }
    });

    const events = rawEvents.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    // Follow each event's /hashes/<slug>/ detail URL. The detail page supplies
    // the start location the list page omits (#1302) AND the rich event body +
    // trail length we fold/lift in (#1354), so we enrich every event with a
    // detail URL — not just the location-less ones.
    const detailEnrichable = events.filter(
      (e) => typeof e.sourceUrl === "string" && /\/hashes\//i.test(e.sourceUrl),
    );
    const { fetched: detailFetched, enriched: detailEnriched } =
      await enrichWithDetails(detailEnrichable, errors, errorDetails);

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        cardsFound: cardIndex,
        eventsParsed: events.length,
        detailFetched,
        detailEnriched,
      },
    };
  }
}
