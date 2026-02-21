import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { googleMapsSearchUrl } from "../utils";

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

export function extractKennelTag(summary: string): string {
  for (const [pattern, tag] of BOSTON_KENNEL_PATTERNS) {
    if (pattern.test(summary)) return tag;
  }
  return "BoH3";
}

export function extractRunNumber(summary: string, description?: string): number | undefined {
  // 1. Check summary first (e.g., "Beantown #255: ...", "BH3: ... #2781")
  const summaryMatch = summary.match(/#(\d+)/);
  if (summaryMatch) return parseInt(summaryMatch[1], 10);

  if (!description) return undefined;

  // 2. Fall back to description — BH3 run numbers like "BH3 #2784"
  const descMatch = description.match(/BH3\s*#\s*(\d+)/i);
  if (descMatch) return parseInt(descMatch[1], 10);

  // 3. Standalone run number in description (e.g., "#2792" on its own line)
  const standaloneMatch = description.match(/(?:^|\n)\s*#(\d{3,})\s*(?:\n|$)/m);
  if (standaloneMatch) return parseInt(standaloneMatch[1], 10);

  return undefined;
}

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
    const match = description.match(pattern);
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
    if (new RegExp(regex, "i").test(summary)) return tag;
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
          // Skip cancelled events
          if (item.status === "cancelled") continue;
          if (!item.summary) continue;
          if (!item.start?.dateTime && !item.start?.date) continue;

          // Extract LOCAL date and time from the ISO string.
          // Google Calendar dateTime includes timezone offset, e.g. "2026-02-15T14:00:00-05:00".
          // We need the local date (Feb 15) and local time (14:00), NOT UTC (which would be Feb 15 19:00).
          let dateStr: string;
          let startTime: string | undefined;

          if (item.start.dateTime) {
            // Extract date and time from ISO string directly (local time)
            const dtMatch = item.start.dateTime.match(
              /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/,
            );
            if (dtMatch) {
              dateStr = dtMatch[1];
              startTime = `${dtMatch[2]}:${dtMatch[3]}`;
            } else {
              // Fallback: parse as Date
              const d = new Date(item.start.dateTime);
              dateStr = d.toISOString().split("T")[0];
            }
          } else {
            // All-day event: start.date is already YYYY-MM-DD
            dateStr = item.start.date!;
          }

          // Strip HTML from description (preserve newlines for hare extraction)
          const rawDescription = item.description
            ? item.description
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/&lt;/gi, "<")
                .replace(/&gt;/gi, ">")
                .replace(/&quot;/gi, '"')
                .replace(/&#0?39;/gi, "'")
            : undefined;

          const description = rawDescription
            ? rawDescription.replace(/[ \t]+/g, " ").trim().substring(0, 2000) || undefined
            : undefined;

          // Extract hares from description (before collapsing newlines for display)
          const hares = rawDescription
            ? extractHares(rawDescription)
            : undefined;

          // Kennel tag resolution: config patterns → defaultKennelTag → Boston fallback
          const sourceConfig = (source.config && typeof source.config === "object" && !Array.isArray(source.config))
            ? source.config as CalendarSourceConfig
            : null;
          let kennelTag: string;
          if (sourceConfig?.kennelPatterns) {
            kennelTag = matchConfigPatterns(item.summary, sourceConfig.kennelPatterns)
              ?? sourceConfig.defaultKennelTag
              ?? extractKennelTag(item.summary);
          } else if (sourceConfig?.defaultKennelTag) {
            kennelTag = sourceConfig.defaultKennelTag;
          } else {
            kennelTag = extractKennelTag(item.summary);
          }

          // Use full summary as title when config-driven (not Boston pattern-based)
          const useFullTitle = !!(sourceConfig?.kennelPatterns || sourceConfig?.defaultKennelTag);

          events.push({
            date: dateStr,
            kennelTag,
            runNumber: extractRunNumber(item.summary, rawDescription),
            title: useFullTitle ? item.summary : extractTitle(item.summary),
            description,
            hares,
            location: item.location,
            locationUrl: item.location ? mapsUrl(item.location) : undefined,
            startTime,
            sourceUrl: item.htmlLink,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Event parse error (${item.summary ?? "unknown"}): ${message}`);
          const rawParts = [`Summary: ${item.summary ?? "unknown"}`];
          if (item.description) rawParts.push(`Description: ${item.description}`);
          if (item.location) rawParts.push(`Location: ${item.location}`);
          if (item.start) rawParts.push(`Start: ${item.start.dateTime ?? item.start.date ?? ""}`);
          errorDetails.parse = [...(errorDetails.parse ?? []), {
            row: eventIndex,
            section: "calendar_events",
            error: message,
            rawText: rawParts.join("\n").slice(0, 2000),
            partialData: { kennelTag: item.summary ?? "unknown", date: item.start?.dateTime ?? item.start?.date },
          }];
        }
        eventIndex++;
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    const hasErrorDetails = (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0;

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
