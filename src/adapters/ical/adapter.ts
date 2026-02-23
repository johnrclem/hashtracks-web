import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { googleMapsSearchUrl } from "../utils";
import { sync as icalSync } from "node-ical";
import type { VEvent, ParameterValue, DateWithTimeZone } from "node-ical";

/** Config shape for iCal feed sources */
export interface ICalSourceConfig {
  kennelPatterns?: [string, string][]; // [[regex, kennelTag], ...] — same as Google Calendar
  defaultKennelTag?: string;           // fallback for unrecognized events
  skipPatterns?: string[];             // SUMMARY patterns to skip (e.g., "Hand Pump Workday")
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
  let matchedPrefix = "";

  // Match against config patterns
  if (kennelPatterns) {
    for (const [regex, tag] of kennelPatterns) {
      const match = new RegExp(regex, "i").exec(summary);
      if (match) {
        kennelTag = tag;
        matchedPrefix = match[0];
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

/**
 * Extract hare names from an iCal DESCRIPTION field.
 * Patterns: "Hare: X", "Hares: X & Y", "Hare(s): X, Y"
 */
export function extractHaresFromDescription(description: string): string | undefined {
  // ICS uses literal \n for newlines
  const normalized = description.replace(/\\n/g, "\n").replace(/\\,/g, ",");

  const patterns = [
    /(?:^|\n)\s*Hares?:\s*(.+)/im,
    /(?:^|\n)\s*Hare\(s\):\s*(.+)/im,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      let hares = match[1].trim();
      // Take only the first line of hare text
      hares = hares.split("\n")[0].trim();
      // Clean up ICS escaping
      hares = hares.replace(/\\;/g, ";").replace(/\\,/g, ",");
      if (hares.length > 0 && hares.length < 200) return hares;
    }
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

/** Fetch and validate ICS content from a URL. Returns icsText and contentType on success, or an error result. */
async function fetchAndValidateIcsContent(
  url: string,
  fetchStart: number,
): Promise<{ icsText: string; contentType: string | undefined } | { error: ScrapeResult }> {
  let contentType: string | undefined;
  try {
    const resp = await fetch(url, { // nosemgrep: ssrf — URL validated by validateSourceUrl() in scrape.ts
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
          diagnosticContext: { url, totalVEvents: 0, eventsExtracted: 0, skippedDateRange: 0, skippedPattern: 0, fetchDurationMs: Date.now() - fetchStart, icsBytes: 0, contentType },
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
          diagnosticContext: { url, totalVEvents: 0, eventsExtracted: 0, skippedDateRange: 0, skippedPattern: 0, fetchDurationMs: Date.now() - fetchStart, icsBytes: icsText.length, contentType, bodyPreview: preview },
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
        diagnosticContext: { url, totalVEvents: 0, eventsExtracted: 0, skippedDateRange: 0, skippedPattern: 0, fetchDurationMs: Date.now() - fetchStart, icsBytes: 0 },
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
        diagnosticContext: { url, totalVEvents: 0, eventsExtracted: 0, skippedDateRange: 0, skippedPattern: 0, fetchDurationMs, icsBytes: icsText.length, contentType },
      },
    };
  }
}

/** Build a RawEventData from a VEvent. Returns null if the event should be skipped. */
function buildRawEventFromVEvent(
  vevent: VEvent,
  config: ICalSourceConfig | null,
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
  const description = paramValue(vevent.description);
  const hares = description ? extractHaresFromDescription(description) : undefined;
  const location = paramValue(vevent.location);

  let locationUrl: string | undefined;
  if (vevent.geo) {
    const geo = vevent.geo;
    if (geo.lat != null && geo.lon != null) {
      locationUrl = `https://www.google.com/maps/search/?api=1&query=${geo.lat},${geo.lon}`;
    }
  } else if (location) {
    locationUrl = mapsUrl(location);
  }

  return {
    date: dateStr,
    kennelTag: parsed.kennelTag,
    runNumber: parsed.runNumber,
    title: parsed.title ?? summary,
    description: description?.substring(0, 2000) || undefined,
    hares,
    location,
    locationUrl,
    startTime,
    sourceUrl: vevent.url ?? undefined,
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

export class ICalAdapter implements SourceAdapter {
  type = "ICAL_FEED" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const days = options?.days ?? 90;
    const fetchStart = Date.now();

    const now = new Date();
    const minDate = new Date(now.getTime() - days * 86_400_000);
    const maxDate = new Date(now.getTime() + days * 86_400_000);

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
    const skipPatterns = config?.skipPatterns?.map((p) => new RegExp(p, "i"));

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

        const event = buildRawEventFromVEvent(vevent, config);
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
            kennelTag: diag.summary,
            date: vevent.start ? formatDate(vevent.start) : undefined,
          },
        });
      }
    }

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

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
      },
    };
  }
}
