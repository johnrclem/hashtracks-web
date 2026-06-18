/**
 * Phoenix Hash House Harriers "Big Ass Calendar" Adapter
 *
 * Scrapes phoenixhhh.org Events Manager calendar via AJAX POST requests.
 * The calendar page (?page_id=21) supports AJAX month navigation, enabling
 * historical and forward event retrieval beyond the iCal feed's ~7 event limit.
 *
 * Events are `.em-item` elements containing date, time, location, description,
 * and a link to the event detail page. Multi-kennel: LBH, Hump D, Wrong Way, FDTDD.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { safeFetch } from "../safe-fetch";
import { parse12HourTime, validateSourceConfig, compilePatterns, buildDateWindow, stripHtmlTags, decodeEntities, extractHashRunNumber, chronoParseDate } from "../utils";
import { extractHares } from "../hare-extraction";

// ── Config shape ──

interface PhoenixHHHConfig {
  kennelPatterns: [string, string][];
  defaultKennelTag: string;
  pageId?: number; // defaults to 21
  /**
   * Max number of forward calendar months to fetch per scrape (default 4 —
   * covers a 90-day `scrapeDays` window, which spans up to four calendar
   * months). Fetching the full ±365d window (~25 months) blew the 120s cron
   * budget and timed out (#2242). The fetch is forward-only (past months never
   * change); the date window still bounds which parsed events are kept.
   */
  maxForwardMonths?: number;
  /**
   * Per-kennel standard hash cash (Two-Tier Hash Cash Model). Keyed by
   * kennelCode. The detail page carries a `Hash Cash:` line on every event;
   * we only promote it to `Event.cost` when it DIFFERS from the kennel's
   * standard here (#1349). When it matches, the kennel-profile `hashCash`
   * already covers it, so a per-event override would be redundant noise.
   */
  kennelHashCash?: Record<string, string>;
}

// ── Exported helpers (for unit testing) ──

// Phoenix-cluster hare patterns. The default `extractHares` set includes a
// generic `Who:` catchall that would capture the age-restriction line
// (#1472 — "Who: People that are at least 21 years old"). The cluster
// always uses `Hare:` / `Hares:` / `Hare(s):` / `With your Hare(s):`, so
// `Who:` is reserved for restrictions and deliberately excluded here.
//
// Capture excludes newline, quote/curly-quote (FDTDD's `"The most evil hash"`
// blurb runs straight off the hare list) and ellipsis. Terminator stops at
// the next labeled section, a quote, or end-of-line.
//
// Both patterns are regex literals — `new RegExp(<expression>)` trips
// Codacy's `security/detect-non-literal-regexp` rule on new code (the
// shared `PHOENIX_HARE_TERMINATOR` was inlined to avoid this).
export const PHOENIX_HARE_PATTERNS: readonly RegExp[] = [
  // FDTDD: "With your Hare: X" / "With your Hares: X, Y" / "With your Hare(s): X" (#1192).
  // The `(?:\(s\))?` group matches the literal `(s)` form alongside `Hare` / `Hares`
  // (codex P1: the kennel uses all three; bare `Hares?` would miss the parenthesized form).
  // S5852 false-positive — Sonar flags `\s*` near alternation; engine
  // anchored to finite label set + character-class exclusion (`[^\n"”…]+?`)
  // makes catastrophic backtracking impossible.
  //
  // #1651: Wrong Way descriptions occasionally collapse to a single line with
  // no `<p>` boundary, so "Hares: Probably you!Bring: H20…" appears verbatim.
  // The terminator set now also includes the body-text labels that follow the
  // hare line (Bring, Cost, Hash Cash, Location, Start, On On, On-after) so
  // the capture stops at "Bring:" instead of trailing into the description.
  /\bWith\s+your\s+Hares?\s*(?:\(s\))?\s*:\s*([^\n"”…]+?)(?=\s*(?:Who|What|When|Where|Wear|Why|How|Theme|Bring|Cost|Hash\s*Cash|Location|Start|On[\s-]?[OAoa]n|On[\s-]?after)\s*:|["”…]|\.{3}|\n|$)/i, // NOSONAR S5852
  // Standard `Hare:` / `Hares:` / `Hare(s):` — anchored to line start OR a
  // sentence boundary so list-view excerpts like "…Harriers!!! Hare(s): …"
  // resolve before detail-page enrichment lands.
  /(?:^|\n|[.!;]\s+)Hares?\s*(?:\(s\))?\s*:\s*([^\n"”…]+?)(?=\s*(?:Who|What|When|Where|Wear|Why|How|Theme|Bring|Cost|Hash\s*Cash|Location|Start|On[\s-]?[OAoa]n|On[\s-]?after)\s*:|["”…]|\.{3}|\n|$)/i, // NOSONAR S5852
];

/**
 * Extract a venue string from a Phoenix HHH description block when the
 * scribe embeds a `Location: <venue>` line. The Big Ass Calendar's
 * `.em-event-location` meta line frequently carries only a city name
 * ("Phoenix") while the actual venue lives in the description body
 * (#1651 — Wrong Way's "Roses by the Stairs Brewing").
 *
 * Two shapes are accepted:
 *   1. `Location: <venue>` on a single line.
 *   2. `Location` on its own line, with `<venue>` on the next non-empty
 *      line — common when scribes paste from a WYSIWYG and the colon
 *      ends up on the label line.
 *
 * Stops at the next labeled section, the next blank line, or a
 * sentence-final punctuation followed by whitespace. Returns undefined
 * when no usable venue line is found so the caller can fall back to the
 * meta-line value.
 *
 * Exported for unit testing.
 */
export function extractVenueFromDescription(description: string): string | undefined {
  // Shape 1: `Location: <venue>` — single line. Anchor the colon variant
  // first because shape 2's bare-label regex would also match a colon-
  // suffixed label if its terminator slipped onto the next line.
  // Use horizontal whitespace `[ \t]*` after the colon so an empty
  // `Location:   \nNext line` doesn't slurp the following line as the
  // venue.
  //
  // Codex P1 (#1695 review): `.em-item-desc` is sometimes flattened to a
  // single line ("Hares: …Bring: …Location: Roses by the Stairs Brewing
  // Time: 6:30 PM Hash Cash: $5"). Without a label terminator, `[^\n]+`
  // would absorb the trailing sections into the venue text and overwrite
  // the cleaner meta-line value via `parseEventFromItem`'s `venue ??
  // metaLocation` fallback. Lazy capture + a label-set lookahead mirrors
  // the terminator strategy in `PHOENIX_HARE_PATTERNS`.
  const colonMatch = /(?:^|\n)[ \t]*Location[ \t]*:[ \t]*([^\n]+?)(?=\s*(?:Who|What|When|Where|Wear|Why|How|Theme|Bring|Cost|Hash\s*Cash|Time|Start|On[\s-]?[OAoa]n|On[\s-]?after)\s*:|\n|$)/i.exec(description); // NOSONAR S5852
  if (colonMatch) {
    const value = colonMatch[1].trim();
    if (value) return value;
  }
  // Shape 2: bare `Location` label (optional trailing colon) on its own
  // line, then `<venue>` on the IMMEDIATELY next line (no blank line in
  // between). Walk lines procedurally rather than relying on a single
  // regex with adjacent `[ \t]*` quantifiers and an optional `:?` near
  // an alternation — that shape trips Sonar S5852 (#1695 review).
  // Normalize NBSP (` `, `&nbsp;`) before label comparison — WordPress
  // / TinyMCE editors sometimes pad labels with NBSP that survive
  // `.text()` extraction (#1702 gemini medium).
  const lines = description.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i].replaceAll(" ", " ").replaceAll("&nbsp;", " ").trim().toLowerCase();
    if (trimmed === "location" || trimmed === "location:") {
      const next = lines[i + 1].trim();
      if (next) return next;
    }
  }
  return undefined;
}

// ── #1348/#1349/#1350: structured field extraction from the detail block ──
// The Big Ass Calendar event detail page carries a labeled key:value block,
// e.g.:
//   Time: Meet at 6:30 PM, Hares off at 6:45, Hounds to follow at 7:00.
//   Bring: Proper illumination...
//   Hash Cash: $1
//   Dog friendly: Usually not on humps
//   On-After: Usually The Same Place We Started from
// The list-view time meta ("6:30 pm - 9:30 pm") is the reliable end-time source.

// Some detail pages separate the labeled fields with `<p>` boundaries
// ("Hash Cash: $1\n\nDog friendly: …"); others mash them onto a single line
// with NO separator ("…vesselHash Cash: $1Cash Needed…Dog friendly: Usually
// not on humpsOn-After: …"). Insert a newline before each known label so the
// line-anchored extractors + description cleaner work uniformly on both shapes
// (mirrors the FIELD_LABEL_SPLIT_RE approach in seven-hills-h3.ts). The label
// set is split across two regexes so neither trips Sonar's regex-complexity cap
// (S5843, threshold 20); each alternative carries its own literal colon, so no
// `\s*` sits adjacent to the alternation (S5852 ReDoS) either.
const PHOENIX_LABELS_A_RE = /(Hares:|Where:|When:|Time:|Bring:|Hash Cash:)/gi;
const PHOENIX_LABELS_B_RE =
  /(Cash Needed on Trail:|Dog[ -]?friendly:|On[- ]?On:|On-After:|Things you probably won['’]t need:)/gi;
export function normalizePhoenixDetailBlock(description: string): string {
  return description
    .replaceAll(PHOENIX_LABELS_A_RE, "\n$1")
    .replaceAll(PHOENIX_LABELS_B_RE, "\n$1");
}

/** "6:30 pm - 9:30 pm" → end time "21:30" (#1348). Returns undefined when the
 *  meta line has no range. Locate the dash with a quantifier-free char class
 *  (no ReDoS surface — Sonar S5852), then let `parse12HourTime` pull the closing
 *  time from the trailing slice. */
export function parseTimeRangeEnd(timeText: string): string | undefined {
  const dashIdx = timeText.search(/[-–—]/);
  return dashIdx < 0 ? undefined : parse12HourTime(timeText.slice(dashIdx + 1));
}

/** `Hash Cash: $1` → `$1` (#1349). Single labeled line; value to EOL. */
const HASH_CASH_LINE_RE = /(?:^|\n)[ \t]*Hash[ \t]*Cash[ \t]*:[ \t]*([^\n]+)/i;
export function extractHashCash(description: string): string | undefined {
  const m = HASH_CASH_LINE_RE.exec(description);
  const value = m?.[1]?.trim();
  return value || undefined;
}

/** Normalize a hash-cash string for equality (`"$1 "` == `"$1"`). */
function normalizeCash(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "");
}

/** `Dog friendly: <value>` line → tri-state (#1350), per the RawEventData
 *  explicit-clear contract (atomic-bundle semantics, adapter-patterns.md):
 *    - label absent              → undefined (no signal; preserve existing)
 *    - value classifiable        → true / false
 *    - label present, unparseable → null (clear any stale Event.dogFriendly) */
const DOG_LINE_RE = /(?:^|\n)[ \t]*Dog[\s-]?friendly[ \t]*:[ \t]*([^\n]*)/i;
const DOG_NO_RE = /\b(?:no|not|never|none)\b/i;
const DOG_YES_RE = /\b(?:yes|welcome|welcomed|ok|okay|sure|allowed|leash|leashed|friendly|encouraged|always)\b/i;
export function extractDogFriendly(description: string): boolean | null | undefined {
  const m = DOG_LINE_RE.exec(description);
  if (m == null) return undefined;
  const value = m[1].trim();
  // Negative wins first — "Usually not on humps" must classify as false.
  if (DOG_NO_RE.test(value)) return false;
  if (DOG_YES_RE.test(value)) return true;
  // Label present but the value is empty/blank or too hedged to classify →
  // explicit clear so a stale boolean from a prior scrape doesn't linger.
  return null;
}

/** Strip lines now promoted to structured fields so they don't duplicate in
 *  the free-text description (#1350). `Hash Cash` is always dropped once seen
 *  (it either became `Event.cost` or equals the kennel default); `Dog friendly`
 *  is dropped only when we successfully classified it. */
export function cleanPhoenixDescription(
  description: string,
  opts: { stripHashCash: boolean; stripDogFriendly: boolean },
): string | undefined {
  const kept = description.split("\n").filter((line) => {
    const t = line.trim();
    if (opts.stripHashCash && /^Hash[ \t]*Cash[ \t]*:/i.test(t)) return false;
    if (opts.stripDogFriendly && /^Dog[\s-]?friendly[ \t]*:/i.test(t)) return false;
    return true;
  });
  const out = kept.join("\n").replaceAll(/\n{3,}/g, "\n\n").trim();
  return out || undefined;
}

/** Detail-page extraction result. Null fields mean "missing on the page"
 *  (adapter falls back to list-view values). */
export interface PhoenixEventDetail {
  title: string | null;
  description: string | null;
  hares: string | null;
}

/**
 * Fetch the per-event detail page and extract title, description, and hares.
 *
 * The Big Ass Calendar list view emits a WordPress excerpt that's truncated
 * with `[...]` (#1193) and lacks `<p>` boundaries needed for line-anchored
 * hare patterns (#1192, #1472). The detail page carries the full body with
 * `<p>`-separated labels.
 *
 * Throws on HTTP errors and network failures so the adapter post-loop can
 * distinguish failure modes in `errorDetails.fetch`.
 */
export async function fetchEventDetail(eventUrl: string): Promise<PhoenixEventDetail> {
  const res = await safeFetch(eventUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const h1 = $("article h1, .entry-title, h1.tribe-events-single-event-title").first();
  const titleText = h1.text().trim();
  const title = titleText ? decodeEntities(titleText) : null;

  const contentEl = $(".entry-content, article .em-event-content, .em-event-content").first();
  let description: string | null = null;
  let hares: string | null = null;
  if (contentEl.length > 0) {
    const text = stripHtmlTags(contentEl.html() ?? "", "\n").trim();
    description = text || null;
    if (text) {
      hares = extractHares(text, PHOENIX_HARE_PATTERNS as RegExp[]) ?? null;
    }
  }

  return { title, description, hares };
}

/**
 * Build the FormData parameters for the AJAX month request.
 */
export function buildMonthFormData(
  month: number,
  year: number,
  pageId: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("em_ajax", "1");
  params.set("ajaxCalendar", "1");
  params.set("full", "1");
  params.set("scope", "all");
  params.set("page_id", String(pageId));
  params.set("event_archetype", "event");
  params.set("orderby", "event_start");
  params.set("id", "1");
  params.set("calendar_size", "");
  params.set("has_advanced_trigger", "0");
  params.set("month", String(month));
  params.set("year", String(year));
  return params;
}

/**
 * Parse a single `.em-item` element into a RawEventData.
 * Returns null if the event can't be parsed (missing date).
 */
export function parseEventFromItem(
  $item: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  config: PhoenixHHHConfig,
  compiledPatterns: [RegExp, string][],
): RawEventData | null {
  // Title extraction: try img alt text (present when event has an uploaded image)
  let title: string | undefined;
  const imgEl = $item.find(".em-item-image img");
  if (imgEl.length > 0) {
    const alt = imgEl.attr("alt")?.trim();
    if (alt) title = decodeEntities(alt);
  }
  // If no title from img alt, it will be fetched from the detail page later

  // Date extraction. Events Manager emits two shapes:
  //   - Long: "Monday - 03/02/2026" (single-day events with weekday prefix,
  //     or "Thursday - 04/30/2026 - Sunday - 05/03/2026" multi-day spans)
  //   - Compact: "27 Apr 26" (#1473 — appears for events the plugin renders
  //     in the compact calendar row form; broke the legacy `MM/DD/YYYY`-only
  //     regex against ~half of the May 2026 month grid)
  // Try the long form first (matches an embedded `MM/DD/YYYY` even in the
  // multi-day case — first date wins, matching prior behavior). Fall back to
  // `chronoParseDate` which has a `D MMM YY` fast-path baked in.
  const dateText = $item.find(".em-item-meta-line.em-event-date").text().trim();
  const dateMatch = /(\d{2})\/(\d{2})\/(\d{4})/.exec(dateText);
  let date: string;
  if (dateMatch) {
    const [, mm, dd, yyyy] = dateMatch;
    date = `${yyyy}-${mm}-${dd}`;
  } else {
    const parsed = chronoParseDate(dateText);
    if (!parsed) return null;
    date = parsed;
  }

  // Time extraction: "6:30 pm - 9:30 pm" → start + end (#1348)
  const timeText = $item.find(".em-item-meta-line.em-event-time").text().trim();
  const startTime = parse12HourTime(timeText);
  const endTime = parseTimeRangeEnd(timeText);

  // Location — try link text first, fall back to plain text in meta line
  const locationMeta = $item.find(".em-item-meta-line.em-event-location");
  const locationLink = locationMeta.find("a");
  const metaLocation = (locationLink.length > 0 ? locationLink.text().trim() : locationMeta.text().trim()) || undefined;

  // Description
  const descHtml = $item.find(".em-item-desc").html() ?? "";
  const description = stripHtmlTags(descHtml, "\n").trim() || undefined;

  // #1651: prefer a specific venue from the description's "Location:" block
  // over the meta-line value when the meta is just a city/area name. Wrong
  // Way's list-view location is often "Phoenix" while the description
  // carries the actual venue ("Roses by the Stairs Brewing"). Two shapes
  // covered: `Location: <venue>` on the same line, and a bare `Location\n
  // <venue>` block where the label sits on its own line.
  const venue = description ? extractVenueFromDescription(description) : undefined;
  const location = venue ?? metaLocation;

  // List-view fallback (post-loop detail fetch usually overrides this).
  // Phoenix-scoped patterns omit the generic `Who:` catchall — see #1472.
  const hares = description
    ? extractHares(description, PHOENIX_HARE_PATTERNS as RegExp[])
    : undefined;

  // Source URL from read-more link
  const readMoreHref = $item.find("a.em-item-read-more").attr("href");
  let sourceUrl: string | undefined;
  if (readMoreHref) {
    try {
      sourceUrl = new URL(readMoreHref, "https://www.phoenixhhh.org").toString();
    } catch {
      sourceUrl = readMoreHref;
    }
  }

  // Kennel tag resolution via config patterns
  let kennelTag = config.defaultKennelTag;
  const matchText = title ?? "";
  for (const [pattern, tag] of compiledPatterns) {
    if (pattern.test(matchText)) {
      kennelTag = tag;
      break;
    }
  }

  return {
    date,
    kennelTags: [kennelTag],
    title,
    runNumber: extractHashRunNumber(title),
    description,
    hares,
    location,
    startTime,
    endTime,
    sourceUrl,
  };
}

// ── Adapter class ──

export class PhoenixHHHAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<PhoenixHHHConfig>(
      source.config,
      "PhoenixHHHAdapter",
      { kennelPatterns: "array", defaultKennelTag: "string" },
    );

    const pageId = config.pageId ?? 21;
    const { minDate, maxDate } = buildDateWindow(options?.days);

    // Compile kennel patterns once
    const patternStrings = config.kennelPatterns.map(([p]) => p);
    const compiledRegexes = compilePatterns(patternStrings);
    const compiledPatterns: [RegExp, string][] = compiledRegexes.map((re, i) => [
      re,
      config.kennelPatterns[i][1],
    ]);

    // Calculate the FETCH month range. Forward-only: past calendar months never
    // change, and re-fetching ~12 of them every day (each a slow AJAX POST) blew
    // the 120s cron budget and timed out (#2242). Start at the current month and
    // cap the span via `maxForwardMonths` (default 4), never going past the date
    // window's natural end. The default of 4 covers a 90-day `scrapeDays` window,
    // which spans up to four calendar months (e.g. Jun 18 → Sep 16) — a 3-month
    // cap dropped the last partial month's events. The [minDate, maxDate] window
    // from buildDateWindow still governs which parsed events are KEPT below.
    const now = new Date();
    const startMonth = now.getUTCMonth() + 1;
    const startYear = now.getUTCFullYear();

    // Defensive parse: a misconfigured non-numeric `maxForwardMonths` must not
    // NaN-poison the index math and silently skip the whole loop.
    const rawMax =
      typeof config.maxForwardMonths === "number"
        ? config.maxForwardMonths
        : Number(config.maxForwardMonths);
    const maxForwardMonths =
      Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 4;
    const startIndex = startYear * 12 + (startMonth - 1);
    const capEndIndex = startIndex + (maxForwardMonths - 1);
    const windowEndIndex = maxDate.getUTCFullYear() * 12 + maxDate.getUTCMonth();
    const endIndex = Math.min(capEndIndex, windowEndIndex);
    const endYear = Math.floor(endIndex / 12);
    const endMonth = (endIndex % 12) + 1;

    const allEvents: RawEventData[] = [];
    const seenKeys = new Set<string>(); // dedup month boundary spillover
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const allParseErrors: ParseError[] = [];
    let totalItems = 0;
    let monthsFetched = 0;

    // Iterate through each month in the range
    let currentYear = startYear;
    let currentMonth = startMonth;

    while (
      currentYear < endYear ||
      (currentYear === endYear && currentMonth <= endMonth)
    ) {
      try {
        const formData = buildMonthFormData(currentMonth, currentYear, pageId);

        const response = await safeFetch(source.url, {
          method: "POST",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        if (!response.ok) {
          const message = `Month ${currentMonth}/${currentYear}: HTTP ${response.status}`;
          allErrors.push(message);
          errorDetails.fetch ??= [];
          errorDetails.fetch.push({ url: source.url, status: response.status, message });
        } else {
          const html = await response.text();
          const $ = cheerio.load(html);
          const items = $(".em-item");

          monthsFetched++;
          totalItems += items.length;

          items.each((i, el) => {
            try {
              const event = parseEventFromItem($(el), $, config, compiledPatterns);
              if (!event) {
                allParseErrors.push({
                  row: i,
                  section: `month-${currentYear}-${String(currentMonth).padStart(2, "0")}`,
                  field: "date",
                  error: "Could not extract date from event item",
                });
                return;
              }

              // Filter by date window + dedup (month views include spillover days from adjacent months)
              const eventDate = new Date(event.date + "T12:00:00Z");
              const dedupKey = `${event.date}|${event.sourceUrl ?? event.title ?? ""}`;
              if (eventDate >= minDate && eventDate <= maxDate && !seenKeys.has(dedupKey)) {
                seenKeys.add(dedupKey);
                allEvents.push(event);
              }
            } catch (err) {
              allParseErrors.push({
                row: i,
                section: `month-${currentYear}-${String(currentMonth).padStart(2, "0")}`,
                error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          });
        }
      } catch (err) {
        const message = `Month ${currentMonth}/${currentYear}: Fetch failed: ${err}`;
        allErrors.push(message);
        errorDetails.fetch ??= [];
        errorDetails.fetch.push({ url: source.url, message });
      }

      // Advance to next month
      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }

      // Rate limiting: 300ms delay between month requests
      if (
        currentYear < endYear ||
        (currentYear === endYear && currentMonth <= endMonth)
      ) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Detail-page enrichment for every event with a sourceUrl. See
    // `fetchEventDetail` docblock for the #1192/#1193/#1472 rationale.
    const needsDetail = allEvents.filter((e) => e.sourceUrl);
    let detailsFetched = 0;
    let detailFetchFailures = 0;
    let titlesFetched = 0;
    const DETAIL_CONCURRENCY = 3;
    const DETAIL_BATCH_DELAY = 300;
    const MAX_DETAIL_FETCH_ERROR_SAMPLES = 5;

    for (let i = 0; i < needsDetail.length; i += DETAIL_CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, DETAIL_BATCH_DELAY));

      const batch = needsDetail.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((e) => fetchEventDetail(e.sourceUrl!)),
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        if (result.status === "rejected") {
          // Detail-fetch enrichment failed — fall back to the list-view
          // excerpt. Surface a bounded sample in `errorDetails.fetch` so a
          // sustained failure rate (origin rate-limit, outage) doesn't
          // silently re-introduce truncated descriptions across the cluster.
          detailFetchFailures++;
          if (detailFetchFailures <= MAX_DETAIL_FETCH_ERROR_SAMPLES) {
            errorDetails.fetch ??= [];
            errorDetails.fetch.push({
              url: batch[j].sourceUrl!,
              message: `Detail fetch failed: ${String(result.reason).slice(0, 120)}`,
            });
          }
          continue;
        }
        const detail = result.value;
        detailsFetched++;

        if (detail.title) {
          batch[j].title = detail.title;
          // Re-resolve kennel tag now that we have the real title
          for (const [pattern, tag] of compiledPatterns) {
            if (pattern.test(detail.title)) {
              batch[j].kennelTags[0] = tag;
              break;
            }
          }
          // #1211: detail-page title is the authoritative run number source.
          // Always overwrite when the fetched title yields a number — the
          // list-page img.alt may carry a stale placeholder (e.g. "Wrong Way
          // #1155 need hares") that the kennel later corrected on the detail
          // page (#1156). Falling back to the previous value only when the
          // detail title yields nothing keeps us no worse than before.
          const detailRun = extractHashRunNumber(detail.title);
          if (detailRun !== undefined) batch[j].runNumber = detailRun;
          titlesFetched++;
        }
        if (detail.description) batch[j].description = detail.description;
        if (detail.hares) batch[j].hares = detail.hares;
      }
    }

    // ── Structured field extraction from the (now detail-enriched) description ──
    // cost (#1349), dogFriendly (#1350). Runs after detail enrichment so it
    // reads the authoritative full body, and after kennel-tag re-resolution so
    // the Two-Tier cost comparison uses the correct kennel default.
    const kennelHashCash = config.kennelHashCash ?? {};
    for (const e of allEvents) {
      if (!e.description) continue;
      // Normalize the two detail-block shapes (separated vs. single-line mashed)
      // into one-label-per-line before extracting + cleaning.
      const normalized = normalizePhoenixDetailBlock(e.description);
      const rawCash = extractHashCash(normalized);
      const dog = extractDogFriendly(normalized);
      // Tri-state: undefined = no label (preserve), null = unparseable (clear),
      // boolean = classified. null/boolean both propagate to the merge contract.
      if (dog !== undefined) e.dogFriendly = dog;
      // Two-Tier (#1349): when the detail page shows a Hash Cash line, persist a
      // per-event cost only if it DIFFERS from the kennel's standard; when it
      // matches, emit null (explicit clear) so a stale per-event override is
      // wiped on re-scrape rather than preserved. Hump D ($1 == $1) → null.
      const standard = kennelHashCash[e.kennelTags[0]];
      if (rawCash !== undefined) {
        e.cost =
          standard && normalizeCash(rawCash) === normalizeCash(standard) ? null : rawCash;
      }
      e.description = cleanPhoenixDescription(normalized, {
        stripHashCash: rawCash !== undefined,
        // Keep the raw `Dog friendly:` line when it was unparseable (dog === null)
        // so the hedged text stays visible; only strip once classified.
        stripDogFriendly: typeof dog === "boolean",
      });
    }

    if (allParseErrors.length > 0) {
      errorDetails.parse = allParseErrors;
    }

    const hasErrors = Object.keys(errorDetails).length > 0;

    return {
      events: allEvents,
      errors: allErrors,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        monthsFetched,
        totalItems,
        eventsParsed: allEvents.length,
        detailsFetched,
        detailFetchFailures,
        eventsWithoutDetail: needsDetail.length - detailsFetched,
        titlesFetched,
        eventsWithoutTitle: needsDetail.length - titlesFetched,
        parseErrors: allParseErrors.length,
      },
    };
  }
}
