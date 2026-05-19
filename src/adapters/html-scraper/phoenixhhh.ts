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
  /\bWith\s+your\s+Hares?\s*(?:\(s\))?\s*:\s*([^\n"”…]+?)(?=\s*(?:Who|What|When|Where|Wear|Why|How|Theme)\s*:|["”…]|\.{3}|\n|$)/i, // NOSONAR S5852
  // Standard `Hare:` / `Hares:` / `Hare(s):` — anchored to line start OR a
  // sentence boundary so list-view excerpts like "…Harriers!!! Hare(s): …"
  // resolve before detail-page enrichment lands.
  /(?:^|\n|[.!;]\s+)Hares?\s*(?:\(s\))?\s*:\s*([^\n"”…]+?)(?=\s*(?:Who|What|When|Where|Wear|Why|How|Theme)\s*:|["”…]|\.{3}|\n|$)/i, // NOSONAR S5852
];

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

  // Time extraction: "6:30 pm - 9:30 pm"
  const timeText = $item.find(".em-item-meta-line.em-event-time").text().trim();
  const startTime = parse12HourTime(timeText);

  // Location — try link text first, fall back to plain text in meta line
  const locationMeta = $item.find(".em-item-meta-line.em-event-location");
  const locationLink = locationMeta.find("a");
  const location = (locationLink.length > 0 ? locationLink.text().trim() : locationMeta.text().trim()) || undefined;

  // Description
  const descHtml = $item.find(".em-item-desc").html() ?? "";
  const description = stripHtmlTags(descHtml, "\n").trim() || undefined;

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

    // Calculate month range from date window
    const startMonth = minDate.getUTCMonth() + 1;
    const startYear = minDate.getUTCFullYear();
    const endMonth = maxDate.getUTCMonth() + 1;
    const endYear = maxDate.getUTCFullYear();

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
