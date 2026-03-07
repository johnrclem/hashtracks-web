import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { validateSourceConfig, stripHtmlTags, buildDateWindow } from "../utils";
import { safeFetch } from "../safe-fetch";

/** Source.config shape for Meetup sources. */
export interface MeetupConfig {
  /** Meetup group URL name, e.g. "brooklyn-hash-house-harriers". */
  groupUrlname: string;
  /** Kennel shortName to assign all events to. */
  kennelTag: string;
}

/** Shape of an event entry in Meetup's __NEXT_DATA__ Apollo state. */
interface ApolloEvent {
  __typename: string;
  id: string;
  title?: string;
  dateTime?: string;
  endTime?: string;
  status?: string;
  description?: string;
  eventUrl?: string;
  venue?: { __ref?: string; name?: string; address?: string; city?: string; state?: string; lat?: number; lng?: number } | null;
}

/**
 * Extract Event objects from Meetup's __NEXT_DATA__ script tag (Apollo state).
 * Returns an empty array if the state isn't found or can't be parsed.
 */
export function extractApolloEvents(html: string): { events: ApolloEvent[]; state: Record<string, Record<string, unknown>> } {
  const $ = cheerio.load(html);
  const scriptEl = $("#__NEXT_DATA__");
  if (!scriptEl.length) return { events: [], state: {} };

  try {
    const nextData = JSON.parse(scriptEl.text());
    const state: Record<string, Record<string, unknown>> = nextData?.props?.pageProps?.__APOLLO_STATE__;
    if (!state || typeof state !== "object") return { events: [], state: {} };

    const events: ApolloEvent[] = [];
    for (const v of Object.values(state)) {
      if (v != null && typeof v === "object" && (v as Record<string, unknown>).__typename === "Event") {
        events.push(v as unknown as ApolloEvent);
      }
    }

    return { events, state };
  } catch {
    return { events: [], state: {} };
  }
}

/**
 * Resolve a venue from Apollo state — handles both inline objects and __ref lookups.
 */
function resolveVenue(
  state: Record<string, Record<string, unknown>>,
  venue: ApolloEvent["venue"],
): { location?: string; latitude?: number; longitude?: number } {
  if (!venue) return {};

  // Resolve __ref if present
  const resolved = venue.__ref ? (state[venue.__ref] as ApolloEvent["venue"]) : venue;
  if (!resolved) return {};

  const parts = [resolved.name, resolved.address, resolved.city, resolved.state].filter(Boolean);
  return {
    location: parts.length > 0 ? parts.join(", ") : undefined,
    latitude: typeof resolved.lat === "number" ? resolved.lat : undefined,
    longitude: typeof resolved.lng === "number" ? resolved.lng : undefined,
  };
}

/** Strip HTML tags from Meetup description and truncate. */
function cleanMeetupDescription(desc: string | undefined): string | undefined {
  if (!desc) return undefined;
  return stripHtmlTags(desc).slice(0, 2000) || undefined;
}

/**
 * Extract local date and time from an ISO 8601 dateTime string.
 * "2026-03-05T18:30:00-05:00" → { date: "2026-03-05", startTime: "18:30" }
 * Uses the local portion of the string (not UTC conversion).
 */
function extractDateTime(dateTime: string): { date: string; startTime: string } {
  return {
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
  };
}

/** Build a RawEventData from an Apollo event entry. */
function buildRawEventFromApollo(
  ev: ApolloEvent,
  state: Record<string, Record<string, unknown>>,
  kennelTag: string,
): RawEventData {
  const { date, startTime } = ev.dateTime
    ? extractDateTime(ev.dateTime)
    : { date: "", startTime: undefined };

  const venueInfo = resolveVenue(state, ev.venue);

  return {
    date,
    kennelTag,
    title: ev.title || undefined,
    description: cleanMeetupDescription(ev.description),
    location: venueInfo.location,
    latitude: venueInfo.latitude,
    longitude: venueInfo.longitude,
    startTime,
    sourceUrl: ev.eventUrl || undefined,
  };
}

/**
 * Meetup.com HTML scraper adapter.
 *
 * Scrapes the public events page and extracts event data from the
 * embedded __APOLLO_STATE__ JSON (the Meetup v3 REST API was shut down
 * in Jan 2022 and the GraphQL API requires OAuth).
 *
 * Config: { groupUrlname: string, kennelTag: string }
 */
export class MeetupAdapter implements SourceAdapter {
  type = "MEETUP" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: MeetupConfig;
    try {
      config = validateSourceConfig<MeetupConfig>(source.config, "MeetupAdapter", {
        groupUrlname: "string",
        kennelTag: "string",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid source config";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days);

    const errorDetails: ErrorDetails = {};
    const events: RawEventData[] = [];
    const errors: string[] = [];

    const pageUrl = `https://www.meetup.com/${encodeURIComponent(config.groupUrlname)}/events/`;

    let html: string;
    try {
      const res = await safeFetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (!res.ok) {
        const message = `Meetup page error ${res.status} for group "${config.groupUrlname}"`;
        return {
          events: [],
          errors: [message],
          errorDetails: { fetch: [{ url: pageUrl, status: res.status, message }] },
        };
      }

      html = await res.text();
    } catch (err) {
      const message = `Failed to fetch Meetup events: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: pageUrl, message }] } };
    }

    const { events: apolloEvents, state } = extractApolloEvents(html);

    if (apolloEvents.length === 0) {
      const message = "No events found in __NEXT_DATA__ Apollo state";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    for (const [i, ev] of apolloEvents.entries()) {
      try {
        if (!ev.dateTime) continue;

        const eventDate = new Date(ev.dateTime);
        if (eventDate < minDate || eventDate > maxDate) continue;

        events.push(buildRawEventFromApollo(ev, state, config.kennelTag));
      } catch (err) {
        const msg = `Failed to parse event "${ev.id}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        errorDetails.parse = [...(errorDetails.parse ?? []), { row: i, error: msg }];
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: { groupUrlname: config.groupUrlname, eventsFound: apolloEvents.length },
    };
  }
}
