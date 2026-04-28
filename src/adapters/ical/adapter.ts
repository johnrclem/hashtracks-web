import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, compilePatterns, appendDescriptionSuffix, isPlaceholder } from "../utils";
import { safeFetch } from "../safe-fetch";
import { enrichSFH3Events } from "../html-scraper/sfh3-detail-enrichment";
import { enrichBerlinH3Events } from "../html-scraper/berlin-h3-detail-enrichment";
import { sync as icalSync } from "node-ical";
import type { VEvent, ParameterValue, DateWithTimeZone } from "node-ical";

/** Config shape for iCal feed sources */
export interface ICalSourceConfig {
  kennelPatterns?: [string, string][]; // [[regex, kennelTag], ...] — same as Google Calendar
  defaultKennelTag?: string;           // fallback for unrecognized events
  skipPatterns?: string[];             // SUMMARY patterns to skip (e.g., "Hand Pump Workday")
  harePatterns?: string[];             // regex strings to extract hares from descriptions
  runNumberPatterns?: string[];        // regex strings to extract run numbers from descriptions
  locationPatterns?: string[];         // regex strings to extract location from descriptions (overrides default LOCATION_PATTERNS)
  costPatterns?: string[];             // regex strings to extract cost from descriptions (e.g. wordpress-hash-event-api "Hash Cash: 5€")
  titleHarePattern?: string;           // regex to extract hare names from SUMMARY when description has none
  descriptionSuffix?: string;          // static text appended to every event description
  enrichSFH3Details?: boolean;         // fetch sfh3.com/runs/{id} detail pages for canonical title + Comment field
  enrichBerlinH3Details?: boolean;     // fetch berlin-h3.eu event pages for Hares field from wp-event-manager
}

/**
 * Extract the string value from a node-ical ParameterValue.
 * ParameterValue<T> can be T (string) or { val: T, params: P }.
 */
export function paramValue(pv: ParameterValue | undefined): string | undefined {
  if (pv == null) return undefined;
  if (typeof pv === "string") return pv;
  if (typeof pv === "object" && "val" in pv) return pv.val;
  return undefined;
}

/**
 * Parse an iCal SUMMARY field into kennel tag, run number, and title.
 *
 * Common patterns:
 *   "SFH3 #2285: A Very Heated Rivalry" → { kennel: "SFH3", run: 2285, title: "A Very Heated Rivalry" }
 *   "BARH3 #446"                        → { kennel: "BARH3", run: 446, title: undefined }
 *   "FHAC-U: BAWC 5"                    → { kennel: "FHAC-U", run: undefined, title: "BAWC 5" }
 *   "Hand Pump Workday"                 → { kennel: undefined, run: undefined, title: "Hand Pump Workday" }
 */
export function parseICalSummary(
  summary: string,
  kennelPatterns?: [string, string][],
  defaultKennelTag?: string,
): { kennelTag: string; runNumber?: number; title?: string } {
  let kennelTag: string | undefined;
  // Match against config patterns
  if (kennelPatterns) {
    for (const [regex, tag] of kennelPatterns) {
      const match = new RegExp(regex, "i").exec(summary);
      if (match) {
        kennelTag = tag;
        break;
      }
    }
  }

  if (!kennelTag) {
    kennelTag = defaultKennelTag ?? "UNKNOWN";
  }

  // Extract run number: #1234 or #1234.56 or #1234A
  const runMatch = summary.match(/#(\d+)/);
  const runNumber = runMatch ? parseInt(runMatch[1], 10) : undefined;

  // Extract title: everything after "#{number}: " or "{kennel}: " or "{kennel} #{number}: "
  let title: string | undefined;
  // Try stripping "KENNEL #NUM: TITLE" or "KENNEL: TITLE" pattern
  const titleMatch = summary.match(
    /^[A-Za-z0-9 .'-]+(?:\s*#[\d.A-Za-z]+)?:\s*(.+)$/,
  );
  if (titleMatch) {
    title = titleMatch[1].trim() || undefined;
  }

  return { kennelTag, runNumber, title };
}

// Module-level patterns for description field extraction
const HARE_PATTERNS = [
  /(?:^|\n)\s*Hares?:\s*([^\n]+)/im,
  /(?:^|\n)\s*Hare\(s\):\s*([^\n]+)/im,
];
const LOCATION_PATTERNS = [
  /(?:^|\n)\s*Where:\s*([^\n]+)/im,
  /(?:^|\n)\s*Location:\s*([^\n]+)/im,
  /(?:^|\n)\s*Start(?:ing)?\s*(?:Location)?:\s*([^\n]+)/im,
];
const COST_PATTERNS = [
  /(?:^|\n)\s*Hash\s*Cash:\s*([^\n]+)/im,
];
const MAPS_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|goo\.gl\/maps)\S*/i;

/** Normalize ICS escape sequences in a description string. */
function normalizeIcsDescription(description: string): string {
  return description.replaceAll("\\n", "\n").replaceAll("\\,", ",");
}

/**
 * Extract a labeled field value from an ICS-encoded description.
 * Matches patterns like "Label: value", takes the first line, and unescapes ICS sequences.
 */
function extractFieldFromDescription(
  description: string,
  patterns: RegExp[],
  options?: { maxLength?: number; stripUrls?: boolean },
): string | undefined {
  const normalized = normalizeIcsDescription(description);
  const maxLength = options?.maxLength ?? 200;

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      let value = match[1].trim();
      value = value.replaceAll("\\;", ";").replaceAll("\\,", ",");
      if (options?.stripUrls) value = value.replace(/https?:\/\/\S+/g, "").trim();
      if (value.length > 0 && value.length < maxLength) return value;
    }
  }

  return undefined;
}

/**
 * Extract hare names from an iCal DESCRIPTION field.
 * Accepts pre-compiled RegExp[] or raw string[] (compiled on the fly for one-off use).
 * The adapter fetch() pre-compiles once per scrape for efficiency.
 */
export function extractHaresFromDescription(description: string, customPatterns?: string[] | RegExp[]): string | undefined {
  if (customPatterns && customPatterns.length > 0) {
    const compiled = typeof customPatterns[0] === "string"
      ? compilePatterns(customPatterns as string[])
      : customPatterns as RegExp[];
    if (compiled.length > 0) {
      return extractFieldFromDescription(description, compiled);
    }
  }
  return extractFieldFromDescription(description, HARE_PATTERNS);
}

/**
 * Extract run number from an iCal DESCRIPTION field using custom patterns.
 * Each pattern must have a capture group matching digits.
 */
export function extractRunNumberFromDescription(
  description: string,
  compiledPatterns: RegExp[],
): number | undefined {
  for (const pattern of compiledPatterns) {
    const match = pattern.exec(description);
    if (match?.[1]) {
      const num = Number.parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > 0) return num;
    }
  }
  return undefined;
}

/**
 * Extract a location name from an iCal DESCRIPTION field.
 * Accepts pre-compiled RegExp[] for custom patterns; falls back to default LOCATION_PATTERNS.
 * Used as a fallback when the LOCATION field is empty.
 */
export function extractLocationFromDescription(description: string, customPatterns?: RegExp[]): string | undefined {
  return extractFieldFromDescription(description, customPatterns ?? LOCATION_PATTERNS, {
    maxLength: 300,
    stripUrls: true,
  });
}

// #801 Reading H3 format: "...On On: 6:15p Lower Access lot at Monocacy Hill Hares: ..."
// Two-pass extraction (single regex trips SonarCloud complexity cap):
//   1. Find the 'On On:' label.
//   2. Slice to the first sibling label (Hares:/Hash Cash:) or newline.
const ON_ON_LABEL_RE = /On[-\s]?On\s*:\s*/i;
const ON_ON_TERMINATOR_RE = /\s*Hares?:|\s*Hash\s*Cash:|\n/i;
// Guards against "On On On: Cozy Car" (after-run shorthand) false-positive.
const PRECEDING_ON_RE = /\bOn[-\s]$/i;
// Accepts 12-hour ("6:15p", "6:15 pm") and 24-hour ("18:30") leading times.
const LEADING_TIME_RE = /^(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m?\.?|\d{1,2}:\d{2})\s+/i;
const TIME_ONLY_RE = /^(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m?\.?|\d{1,2}:\d{2})$/i;

/**
 * Fallback for iCal DESCRIPTION bodies that embed the venue inline via
 * "On On: {time} {venue} Hares: ..." — common in Localendar-hosted feeds
 * (Reading H3 #801).
 */
export function extractOnOnVenueFromDescription(description: string): string | undefined {
  const normalized = normalizeIcsDescription(description);
  const labelMatch = ON_ON_LABEL_RE.exec(normalized);
  if (!labelMatch) return undefined;
  // Reject after-run "On On On:" shorthand — the leading "On " makes the
  // trailing "On On:" match the label even though it's not the start-point.
  if (labelMatch.index > 0 && PRECEDING_ON_RE.test(normalized.slice(0, labelMatch.index))) {
    return undefined;
  }
  const afterLabel = normalized.slice(labelMatch.index + labelMatch[0].length);
  const termMatch = ON_ON_TERMINATOR_RE.exec(afterLabel);
  const rawVenue = termMatch ? afterLabel.slice(0, termMatch.index) : afterLabel;
  let venue = rawVenue.replace(LEADING_TIME_RE, "").trim();
  venue = venue.replaceAll(String.raw`\;`, ";").replaceAll(String.raw`\,`, ",");
  if (venue.length < 3 || venue.length > 300) return undefined;
  // Reject captures that are nothing but a time or a stray punctuation fragment.
  if (TIME_ONLY_RE.test(venue)) return undefined;
  return venue;
}

/**
 * Extract a cost/hash-cash value from an iCal DESCRIPTION field.
 * Accepts pre-compiled RegExp[] for custom patterns; falls back to default COST_PATTERNS.
 * Short maxLength (100) guards against picking up multi-line paragraphs.
 */
export function extractCostFromDescription(description: string, customPatterns?: RegExp[]): string | undefined {
  return extractFieldFromDescription(description, customPatterns ?? COST_PATTERNS, {
    maxLength: 100,
  });
}

/**
 * Extract a Google Maps URL from an iCal DESCRIPTION field.
 * Used as a fallback when no locationUrl is available from LOCATION or GEO fields.
 */
export function extractMapsUrlFromDescription(description: string): string | undefined {
  const normalized = normalizeIcsDescription(description);

  const match = MAPS_URL_PATTERN.exec(normalized);
  if (match) {
    let url = match[0].replaceAll("\\;", "").replaceAll("\\,", ""); // Strip ICS escape sequences
    url = url.replace(/[),;]+$/, ""); // NOSONAR — bounded input from regex match, no backtracking risk
    return url;
  }

  return undefined;
}

/**
 * Format a DateWithTimeZone as YYYY-MM-DD date string in the event's original timezone.
 * node-ical stores dates as UTC JS Dates — we use Intl.DateTimeFormat to convert back
 * to the original TZID timezone for correct local date/time extraction.
 */
function formatDate(dt: DateWithTimeZone): string {
  if (dt.dateOnly) {
    return dt.toISOString().split("T")[0];
  }
  // Use the event's original timezone (or UTC fallback) to get the correct local date
  const tz = dt.tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Format a DateWithTimeZone as HH:MM time string in the event's original timezone.
 * Returns undefined for date-only events.
 */
function formatTime(dt: DateWithTimeZone): string | undefined {
  if (dt.dateOnly) return undefined;
  const tz = dt.tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

const mapsUrl = googleMapsSearchUrl;

/** Build the shared diagnosticContext shape for iCal error/success results. */
function icalDiagnostics(overrides: {
  url: string;
  fetchDurationMs: number;
  icsBytes?: number;
  contentType?: string;
  [key: string]: unknown;
}): Record<string, unknown> {
  const { url, fetchDurationMs, icsBytes = 0, contentType, ...rest } = overrides;
  return { url, totalVEvents: 0, eventsExtracted: 0, skippedDateRange: 0, skippedPattern: 0, fetchDurationMs, icsBytes, contentType, ...rest };
}

/** Fetch and validate ICS content from a URL. Returns icsText and contentType on success, or an error result. */
async function fetchAndValidateIcsContent(
  url: string,
  fetchStart: number,
): Promise<{ icsText: string; contentType: string | undefined } | { error: ScrapeResult }> {
  let contentType: string | undefined;
  try {
    const resp = await safeFetch(url, {
      headers: { "User-Agent": "HashTracks-Scraper" },
    });

    contentType = resp.headers.get("content-type") ?? undefined;

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const message = `iCal fetch failed ${resp.status}: ${body.substring(0, 500)}`;
      return {
        error: {
          events: [], errors: [message],
          errorDetails: { fetch: [{ url, status: resp.status, message }] },
          diagnosticContext: icalDiagnostics({ url, fetchDurationMs: Date.now() - fetchStart, contentType }),
        },
      };
    }

    const icsText = await resp.text();

    const trimmed = icsText.trimStart().replace(/^\uFEFF/, "");
    if (!trimmed.startsWith("BEGIN:VCALENDAR")) {
      const preview = icsText.substring(0, 200).replace(/\n/g, "\\n");
      const message = `Response is not valid ICS (content-type: ${contentType ?? "unknown"}, starts with: "${preview}")`;
      return {
        error: {
          events: [], errors: [message],
          errorDetails: { fetch: [{ url, message }] },
          diagnosticContext: icalDiagnostics({ url, fetchDurationMs: Date.now() - fetchStart, icsBytes: icsText.length, contentType, bodyPreview: preview }),
        },
      };
    }

    return { icsText, contentType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        events: [], errors: [`iCal fetch error: ${message}`],
        errorDetails: { fetch: [{ url, message }] },
        diagnosticContext: icalDiagnostics({ url, fetchDurationMs: Date.now() - fetchStart }),
      },
    };
  }
}

/** Parse ICS text into a calendar object. Returns the calendar or an error result. */
function parseIcsCalendar(
  icsText: string,
  url: string,
  fetchDurationMs: number,
  contentType: string | undefined,
): { calendar: ReturnType<typeof icalSync.parseICS> } | { error: ScrapeResult } {
  try {
    return { calendar: icalSync.parseICS(icsText) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        events: [], errors: [`iCal parse error: ${message}`],
        errorDetails: { parse: [{ row: 0, error: message }] },
        diagnosticContext: icalDiagnostics({ url, fetchDurationMs, icsBytes: icsText.length, contentType }),
      },
    };
  }
}

/** Resolve a locationUrl from GEO field, description Maps URL, or location name search. */
function resolveLocationUrl(
  geo: VEvent["geo"],
  location: string | undefined,
  description: string | undefined,
): string | undefined {
  if (geo) {
    const { lat, lon } = geo;
    if (lat != null && lon != null) {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    }
  }
  if (description) {
    const descUrl = extractMapsUrlFromDescription(description);
    if (descUrl) return descUrl;
  }
  if (location) return mapsUrl(location);
  return undefined;
}

/** Build a RawEventData from a VEvent. Returns null if the event should be skipped. */
function buildRawEventFromVEvent(
  vevent: VEvent,
  config: ICalSourceConfig | null,
  compiledHarePatterns?: RegExp[],
  compiledRunNumberPatterns?: RegExp[],
  compiledTitleHarePattern?: RegExp,
  compiledLocationPatterns?: RegExp[],
  compiledCostPatterns?: RegExp[],
): RawEventData | null {
  if (vevent.status === "CANCELLED") return null;

  const summary = paramValue(vevent.summary);
  if (!summary) return null;
  if (!vevent.start) return null;

  const parsed = parseICalSummary(
    summary,
    config?.kennelPatterns,
    config?.defaultKennelTag,
  );

  const dateStr = formatDate(vevent.start);
  const startTime = formatTime(vevent.start);
  // endTime is HH:MM only, so cross-date DTEND values (overnight runs) are dropped.
  const endDt = vevent.end as DateWithTimeZone | undefined;
  const endTime = endDt && formatDate(endDt) === dateStr ? formatTime(endDt) : undefined;
  const description = paramValue(vevent.description);
  let hares = description ? extractHaresFromDescription(description, compiledHarePatterns) : undefined;

  // Fall back to extracting hares from title when description has none
  if (!hares && compiledTitleHarePattern) {
    const titleMatch = compiledTitleHarePattern.exec(summary);
    if (titleMatch?.[1]) {
      hares = titleMatch[1].trim() || undefined;
    }
  }

  let location = paramValue(vevent.location);
  if (location && isPlaceholder(location)) {
    location = undefined;
  }

  if (!location && description) {
    location = extractLocationFromDescription(description, compiledLocationPatterns)
      ?? extractOnOnVenueFromDescription(description);
  }

  const locationUrl = resolveLocationUrl(vevent.geo, location, description);

  // Run number: prefer summary extraction, fall back to description with custom patterns
  let runNumber = parsed.runNumber;
  if (runNumber == null && description && compiledRunNumberPatterns?.length) {
    runNumber = extractRunNumberFromDescription(description, compiledRunNumberPatterns);
  }

  const cost = description ? extractCostFromDescription(description, compiledCostPatterns) : undefined;

  return {
    date: dateStr,
    kennelTags: [parsed.kennelTag],
    runNumber,
    title: parsed.title ?? summary,
    description: appendDescriptionSuffix(description?.substring(0, 2000) || undefined, config?.descriptionSuffix),
    hares,
    location,
    locationUrl,
    startTime,
    endTime,
    cost,
    sourceUrl: paramValue(vevent.url) ?? undefined,
  };
}

/** Build diagnostic context string for a VEvent parse error. */
function buildICalDiagnosticContext(vevent: VEvent): { rawText: string; summary: string } {
  const summary = paramValue(vevent.summary) ?? "unknown";
  const rawParts = [`Summary: ${summary}`];
  if (vevent.description) rawParts.push(`Description: ${paramValue(vevent.description) ?? ""}`);
  if (vevent.location) rawParts.push(`Location: ${paramValue(vevent.location) ?? ""}`);
  if (vevent.start) rawParts.push(`Start: ${String(vevent.start)}`);
  return { rawText: rawParts.join("\n").slice(0, 2000), summary };
}

/** iCal feed adapter. Parses .ics feeds using node-ical, supports kennel pattern matching and multi-kennel feeds. */
export class ICalAdapter implements SourceAdapter {
  type = "ICAL_FEED" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    // Fixed 90-day lookback for historical events; use source.scrapeDays for
    // forward window — iCal feeds often publish events 6+ months in advance.
    // Note: scrapeSource() passes source.scrapeDays as options.days, so we read
    // source.scrapeDays directly to avoid the symmetric window that would create.
    const lookbackDays = 90;
    const lookforwardDays = source.scrapeDays ?? 365;
    const fetchStart = Date.now();

    const now = new Date();
    const minDate = new Date(now.getTime() - lookbackDays * 86_400_000);
    const maxDate = new Date(now.getTime() + lookforwardDays * 86_400_000);

    // Step 1: Fetch the ICS content
    const fetchResult = await fetchAndValidateIcsContent(source.url, fetchStart);
    if ("error" in fetchResult) return fetchResult.error;

    const { icsText, contentType } = fetchResult;
    const fetchDurationMs = Date.now() - fetchStart;

    // Step 2: Parse the ICS content
    const parseResult = parseIcsCalendar(icsText, source.url, fetchDurationMs, contentType);
    if ("error" in parseResult) return parseResult.error;

    const { calendar } = parseResult;

    // Step 3: Process VEVENT entries
    const config = (source.config && typeof source.config === "object" && !Array.isArray(source.config))
      ? source.config as ICalSourceConfig
      : null;
    const skipPatterns = config?.skipPatterns?.length
      ? compilePatterns(config.skipPatterns, "i")
      : undefined;
    const compiledHarePatterns = config?.harePatterns?.length
      ? compilePatterns(config.harePatterns)
      : undefined;
    const compiledRunNumberPatterns = config?.runNumberPatterns?.length
      ? compilePatterns(config.runNumberPatterns)
      : undefined;
    const compiledLocationPatterns = config?.locationPatterns?.length
      ? compilePatterns(config.locationPatterns)
      : undefined;
    const compiledCostPatterns = config?.costPatterns?.length
      ? compilePatterns(config.costPatterns)
      : undefined;
    const compiledTitleHarePattern = config?.titleHarePattern
      ? compilePatterns([config.titleHarePattern], "i")[0]
      : undefined;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let totalVEvents = 0;
    let skippedDateRange = 0;
    let skippedPattern = 0;
    let eventIndex = 0;
    const parseErrors: ParseError[] = [];

    for (const key of Object.keys(calendar)) {
      const component = calendar[key];
      if (!component || typeof component !== "object" || !("type" in component)) continue;
      if (component.type !== "VEVENT") continue;

      const vevent = component as VEvent;
      totalVEvents++;
      eventIndex++;

      try {
        const summary = paramValue(vevent.summary);
        if (!summary) continue;
        if (vevent.status === "CANCELLED") continue;

        if (skipPatterns?.some((p) => p.test(summary))) {
          skippedPattern++;
          continue;
        }

        if (!vevent.start) continue;
        if (vevent.start < minDate || vevent.start > maxDate) {
          skippedDateRange++;
          continue;
        }

        const event = buildRawEventFromVEvent(vevent, config, compiledHarePatterns, compiledRunNumberPatterns, compiledTitleHarePattern, compiledLocationPatterns, compiledCostPatterns);
        if (event) events.push(event);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const diag = buildICalDiagnosticContext(vevent);
        errors.push(`Event parse error (${diag.summary}): ${message}`);
        parseErrors.push({
          row: eventIndex,
          section: "vevent",
          error: message,
          rawText: diag.rawText,
          partialData: {
            kennelTags: [diag.summary],
            date: vevent.start ? formatDate(vevent.start) : undefined,
          },
        });
      }
    }

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    // SFH3-specific enrichment: the .ics SUMMARY omits "Run" and has no Comment
    // field. Pull the canonical title + Comment from /runs/{id} so the merge
    // pipeline has enriched values on both the iCal and HTML_SCRAPER RawEvents
    // and whichever source wins ends up correct.
    let enrichmentEnriched: number | undefined;
    let enrichmentFailures: number | undefined;
    if (config?.enrichSFH3Details) {
      const enrichResult = await enrichSFH3Events(events, { now: new Date(fetchStart) });
      enrichmentEnriched = enrichResult.enriched;
      enrichmentFailures = enrichResult.failures.length;
      if (enrichResult.failures.length > 0) {
        errorDetails.fetch ??= [];
        for (const failure of enrichResult.failures) {
          errorDetails.fetch.push({ url: failure.url, message: failure.message });
        }
        // Single summary line in `errors` — per-fetch details live in errorDetails.fetch
        // and the count is in diagnosticContext.enrichmentFailures.
        errors.push(`enrichment: ${enrichResult.failures.length} detail-page fetch(es) failed`);
      }
    }

    // Berlin H3 enrichment: the .ics DESCRIPTION lacks structured Hares — the
    // wp-event-manager event page has them as <strong>Hares -</strong> {name}.
    if (config?.enrichBerlinH3Details) {
      const enrichResult = await enrichBerlinH3Events(events, { now: new Date(fetchStart) });
      enrichmentEnriched = (enrichmentEnriched ?? 0) + enrichResult.enriched;
      enrichmentFailures = (enrichmentFailures ?? 0) + enrichResult.failures.length;
      if (enrichResult.failures.length > 0) {
        errorDetails.fetch ??= [];
        for (const failure of enrichResult.failures) {
          errorDetails.fetch.push({ url: failure.url, message: failure.message });
        }
        errors.push(`berlin-h3 enrichment: ${enrichResult.failures.length} detail-page fetch(es) failed`);
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        url: source.url,
        totalVEvents,
        eventsExtracted: events.length,
        skippedDateRange,
        skippedPattern,
        fetchDurationMs,
        icsBytes: icsText.length,
        contentType,
        ...(enrichmentEnriched !== undefined && { enrichmentEnriched }),
        ...(enrichmentFailures !== undefined && { enrichmentFailures }),
      },
    };
  }
}
