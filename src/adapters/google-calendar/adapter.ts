import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, decodeEntities, stripHtmlTags } from "../utils";

// Kennel patterns derived from actual Boston Hash Calendar event data.
// Longer/more-specific patterns first to avoid false matches.
const BOSTON_KENNEL_PATTERNS: [RegExp, string][] = [
  [/Boston Ball\s*Buster/i, "BoBBH3"],
  [/Ball\s*Buster/i, "BoBBH3"],
  [/BoBBH3/i, "BoBBH3"],
  [/B3H4/i, "BoBBH3"],
  [/BBH3/i, "BoBBH3"],
  [/Beantown/i, "Beantown"],
  [/Pink Taco/i, "Pink Taco"],
  [/PT2H3/i, "Pink Taco"],
  [/Boston Moon/i, "Bos Moon"],
  [/Bos Moo[mn]/i, "Bos Moon"],
  [/Full Moon/i, "Bos Moon"],
  [/\bMoon\b/i, "Bos Moon"],
  [/Boston H3/i, "BoH3"],
  [/Boston Hash/i, "BoH3"],
  [/BoH3/i, "BoH3"],
  [/BH3/i, "BoH3"],
];

/** Extract kennel tag from a Google Calendar event summary using Boston Hash kennel patterns. Falls back to "BoH3". */
export function extractKennelTag(summary: string): string {
  for (const [pattern, tag] of BOSTON_KENNEL_PATTERNS) {
    if (pattern.test(summary)) return tag;
  }
  return "BoH3";
}

/** Extract run number from summary (e.g. "#2781") or description. Checks summary first, then description patterns. */
export function extractRunNumber(summary: string, description?: string): number | undefined {
  // 1. Check summary first (e.g., "Beantown #255: ...", "BH3: ... #2781")
  const summaryMatch = /#(\d+)/.exec(summary);
  if (summaryMatch) return Number.parseInt(summaryMatch[1], 10);

  if (!description) return undefined;

  // 2. Fall back to description — BH3 run numbers like "BH3 #2784"
  const descMatch = /BH3\s*#\s*(\d+)/i.exec(description);
  if (descMatch) return Number.parseInt(descMatch[1], 10);

  // 3. Standalone run number in description (e.g., "#2792" on its own line)
  const standaloneMatch = /(?:^|\n)\s*#(\d{3,})\s*(?:\n|$)/m.exec(description);
  if (standaloneMatch) return Number.parseInt(standaloneMatch[1], 10);

  return undefined;
}

/** Strip the "Kennel: " or "Kennel #N: " prefix from a calendar summary to extract the event title. */
export function extractTitle(summary: string): string {
  // Strip "Kennel: " or "Kennel #123: " prefix to get the event name
  const stripped = summary.replace(/^[^:]+:\s*/, "").trim();
  return stripped || summary;
}

/**
 * Extract hare names from the event description.
 * Boston Hash Calendar uses: "Hare: X", "Hares: X & Y", "Who: X and Y"
 */
export function extractHares(description: string): string | undefined {
  // Try each pattern, return first match
  const patterns = [
    /(?:^|\n)\s*Hares?:\s*(.+)/im,
    /(?:^|\n)\s*Who:\s*(.+)/im,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(description);
    if (match) {
      let hares = match[1].trim();
      // Clean up trailing punctuation/whitespace
      hares = hares.split("\n")[0].trim();
      // Skip generic/non-hare "Who:" answers
      if (/^(?:that be you|your|all|everyone)/i.test(hares)) continue;
      if (hares.length > 0 && hares.length < 200) return hares;
    }
  }

  return undefined;
}

const mapsUrl = googleMapsSearchUrl;

/** Config shape for Google Calendar sources */
interface CalendarSourceConfig {
  kennelPatterns?: [string, string][];  // [[regex, kennelTag], ...]
  defaultKennelTag?: string;            // fallback for unrecognized events
}

/**
 * Match event summary against config-driven kennel patterns.
 * Returns the kennel tag for the first matching pattern, or null.
 */
function matchConfigPatterns(summary: string, patterns: [string, string][]): string | null {
  for (const [regex, tag] of patterns) {
    try {
      if (new RegExp(regex, "i").test(summary)) return tag;
    } catch {
      // Skip malformed patterns from source config
    }
  }
  return null;
}

/** Subset of the Google Calendar API v3 event shape */
interface GCalEvent {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
  status?: string;
}

interface GCalListResponse {
  items?: GCalEvent[];
  nextPageToken?: string;
  error?: { code: number; message: string };
}

/** Extract local date and time from a Google Calendar start object. */
function extractDateTimeFromGCalItem(start: { dateTime?: string; date?: string }): { dateISO: string; startTime: string | undefined } {
  if (start.dateTime) {
    const dtMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(
      start.dateTime,
    );
    if (dtMatch) {
      return { dateISO: dtMatch[1], startTime: `${dtMatch[2]}:${dtMatch[3]}` };
    }
    // Fallback: extract date portion directly from the string (avoids UTC date shift)
    const fallbackMatch = /(\d{4}-\d{2}-\d{2})/.exec(start.dateTime);
    if (fallbackMatch) {
      return { dateISO: fallbackMatch[0], startTime: undefined };
    }
    return { dateISO: "", startTime: undefined };
  }
  // All-day event: start.date is already YYYY-MM-DD
  return { dateISO: start.date ?? "", startTime: undefined };
}

/** Strip HTML from description, preserving newlines, and truncate. */
function normalizeGCalDescription(rawDesc: string | undefined): { rawDescription: string | undefined; description: string | undefined } {
  if (!rawDesc) return { rawDescription: undefined, description: undefined };
  const rawDescription = stripHtmlTags(decodeEntities(rawDesc), "\n");
  const description = rawDescription
    ? rawDescription.replace(/[ \t]+/g, " ").trim().substring(0, 2000) || undefined
    : undefined;
  return { rawDescription, description };
}

/** Resolve kennel tag from event summary using config patterns or Boston fallback. */
function resolveKennelTagFromSummary(
  summary: string,
  sourceConfig: CalendarSourceConfig | null,
): { kennelTag: string; useFullTitle: boolean } {
  if (sourceConfig?.kennelPatterns) {
    const kennelTag = matchConfigPatterns(summary, sourceConfig.kennelPatterns)
      ?? sourceConfig.defaultKennelTag
      ?? extractKennelTag(summary);
    return { kennelTag, useFullTitle: true };
  }
  if (sourceConfig?.defaultKennelTag) {
    return { kennelTag: sourceConfig.defaultKennelTag, useFullTitle: true };
  }
  return { kennelTag: extractKennelTag(summary), useFullTitle: false };
}

/** Parse source.config into CalendarSourceConfig or null. */
function parseCalendarSourceConfig(config: unknown): CalendarSourceConfig | null {
  return (config && typeof config === "object" && !Array.isArray(config))
    ? config as CalendarSourceConfig
    : null;
}

/** Build a RawEventData from a single Google Calendar event item. Returns null if the item should be skipped. */
function buildRawEventFromGCalItem(
  item: GCalEvent,
  sourceConfig: CalendarSourceConfig | null,
): RawEventData | null {
  if (item.status === "cancelled") return null;
  if (!item.summary) return null;
  if (!item.start?.dateTime && !item.start?.date) return null;

  const { dateISO, startTime } = extractDateTimeFromGCalItem(item.start);
  if (!dateISO) return null;
  const { rawDescription, description } = normalizeGCalDescription(item.description);
  const hares = rawDescription ? extractHares(rawDescription) : undefined;
  const { kennelTag, useFullTitle } = resolveKennelTagFromSummary(item.summary, sourceConfig);

  return {
    date: dateISO,
    kennelTag,
    runNumber: extractRunNumber(item.summary, rawDescription),
    title: useFullTitle ? item.summary : extractTitle(item.summary),
    description,
    hares,
    location: item.location,
    locationUrl: item.location ? mapsUrl(item.location) : undefined,
    startTime,
    sourceUrl: item.htmlLink,
  };
}

/** Build diagnostic context for a parse error on a GCal item. */
function buildGCalDiagnosticContext(item: GCalEvent): string {
  const rawParts = [`Summary: ${item.summary ?? "unknown"}`];
  if (item.description) rawParts.push(`Description: ${item.description}`);
  if (item.location) rawParts.push(`Location: ${item.location}`);
  if (item.start) rawParts.push(`Start: ${item.start.dateTime ?? item.start.date ?? ""}`);
  return rawParts.join("\n").slice(0, 2000);
}

/** Google Calendar API v3 adapter. Fetches events from a public calendar and extracts kennel tags via configurable patterns. */
export class GoogleCalendarAdapter implements SourceAdapter {
  type = "GOOGLE_CALENDAR" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const days = options?.days ?? 90;
    const calendarId = encodeURIComponent(source.url);
    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;

    if (!apiKey) {
      throw new Error("GOOGLE_CALENDAR_API_KEY environment variable is not set");
    }

    const now = new Date();
    const timeMin = new Date(now.getTime() - days * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + days * 86_400_000).toISOString();

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let pageToken: string | undefined;
    let totalItemsReturned = 0;
    let pagesProcessed = 0;
    const sourceConfig = parseCalendarSourceConfig(source.config);

    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      );
      url.searchParams.set("key", apiKey);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const resp = await fetch(url.toString(), {
        headers: { "User-Agent": "HashTracks-Scraper" },
      });

      if (!resp.ok) {
        const body = await resp.text();
        const message = `Google Calendar API ${resp.status}: ${body}`;
        errors.push(message);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: url.toString(), status: resp.status, message }];
        break;
      }

      const data: GCalListResponse = await resp.json();

      if (data.error) {
        const message = `Google Calendar API error ${data.error.code}: ${data.error.message}`;
        errors.push(message);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: url.toString(), status: data.error.code, message }];
        break;
      }

      pagesProcessed++;
      const items = data.items ?? [];
      totalItemsReturned += items.length;
      let eventIndex = 0;

      for (const item of items) {
        try {
          const event = buildRawEventFromGCalItem(item, sourceConfig);
          if (event) events.push(event);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Event parse error (${item.summary ?? "unknown"}): ${message}`);
          errorDetails.parse = [...(errorDetails.parse ?? []), {
            row: eventIndex,
            section: "calendar_events",
            error: message,
            rawText: buildGCalDiagnosticContext(item),
            partialData: { kennelTag: item.summary ?? "unknown", date: item.start?.dateTime ?? item.start?.date },
          }];
        }
        eventIndex++;
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        calendarId: decodeURIComponent(calendarId),
        pagesProcessed,
        itemsReturned: totalItemsReturned,
      },
    };
  }
}
