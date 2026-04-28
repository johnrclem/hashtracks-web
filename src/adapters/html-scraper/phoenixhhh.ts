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
import { parse12HourTime, validateSourceConfig, compilePatterns, buildDateWindow, stripHtmlTags, decodeEntities } from "../utils";
// Shared hare extraction — lives in GCal adapter but is generic. TODO: move to utils.ts
import { extractHares } from "../google-calendar/adapter";

// ── Config shape ──

interface PhoenixHHHConfig {
  kennelPatterns: [string, string][];
  defaultKennelTag: string;
  pageId?: number; // defaults to 21
}

// ── Exported helpers (for unit testing) ──

/**
 * Fetch the event detail page and extract the title from the `<h1>` heading.
 * Returns null if fetch fails or no title found.
 */
export async function fetchEventTitle(eventUrl: string): Promise<string | null> {
  try {
    const res = await safeFetch(eventUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const h1 = $("article h1, .entry-title, h1.tribe-events-single-event-title").first();
    const title = h1.text().trim();
    return title ? decodeEntities(title) : null;
  } catch {
    return null;
  }
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

  // Date extraction: "Monday - 03/02/2026"
  const dateText = $item.find(".em-item-meta-line.em-event-date").text().trim();
  const dateMatch = /(\d{2})\/(\d{2})\/(\d{4})/.exec(dateText);
  if (!dateMatch) return null;
  const [, mm, dd, yyyy] = dateMatch;
  const date = `${yyyy}-${mm}-${dd}`;

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

  // Hares from description
  const hares = description ? extractHares(description) : undefined;

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
    kennelTags: [kennelTag],    title,
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

    // Fetch titles for events that don't have one (no img.alt — need detail page)
    const needsTitle = allEvents.filter((e) => !e.title && e.sourceUrl);
    let titlesFetched = 0;
    const TITLE_CONCURRENCY = 3;
    const TITLE_BATCH_DELAY = 300;

    for (let i = 0; i < needsTitle.length; i += TITLE_CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, TITLE_BATCH_DELAY));

      const batch = needsTitle.slice(i, i + TITLE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((e) => fetchEventTitle(e.sourceUrl!)),
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled" && result.value) {
          batch[j].title = result.value;
          // Re-resolve kennel tag now that we have the real title
          for (const [pattern, tag] of compiledPatterns) {
            if (pattern.test(result.value)) {
              batch[j].kennelTags[0] = tag;
              break;
            }
          }
          titlesFetched++;
        }
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
        titlesFetched,
        eventsWithoutTitle: needsTitle.length - titlesFetched,
        parseErrors: allParseErrors.length,
      },
    };
  }
}
