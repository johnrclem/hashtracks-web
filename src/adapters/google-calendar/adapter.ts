import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";

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

function extractKennelTag(summary: string): string {
  for (const [pattern, tag] of BOSTON_KENNEL_PATTERNS) {
    if (pattern.test(summary)) return tag;
  }
  return "BoH3";
}

function extractRunNumber(summary: string): number | undefined {
  const match = summary.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractTitle(summary: string): string {
  // Strip "Kennel: " or "Kennel #123: " prefix to get the event name
  const stripped = summary.replace(/^[^:]+:\s*/, "").trim();
  return stripped || summary;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
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
    let pageToken: string | undefined;

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
        throw new Error(`Google Calendar API ${resp.status}: ${body}`);
      }

      const data: GCalListResponse = await resp.json();

      if (data.error) {
        throw new Error(
          `Google Calendar API error ${data.error.code}: ${data.error.message}`,
        );
      }

      for (const item of data.items ?? []) {
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

          // Strip HTML from description
          const description = item.description
            ? stripHtml(item.description).substring(0, 2000) || undefined
            : undefined;

          events.push({
            date: dateStr,
            kennelTag: extractKennelTag(item.summary),
            runNumber: extractRunNumber(item.summary),
            title: extractTitle(item.summary),
            description,
            location: item.location,
            startTime,
            sourceUrl: item.htmlLink,
          });
        } catch (err) {
          errors.push(
            `Event parse error (${item.summary ?? "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return { events, errors };
  }
}
