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
 * Deduplicates venue parts to avoid garbled output from corrupt Meetup data
 * (e.g. "Miami Miami, FL, Miami Miami, FL, Florida, FL" → "Miami Miami, FL, Florida").
 */
export function resolveVenue(
  state: Record<string, Record<string, unknown>>,
  venue: ApolloEvent["venue"],
): { location?: string; latitude?: number; longitude?: number } {
  if (!venue) return {};

  // Resolve __ref if present
  const resolved = venue.__ref ? (state[venue.__ref] as ApolloEvent["venue"]) : venue;
  if (!resolved) return {};

  // Incrementally build location, skipping redundant parts
  const parts: string[] = [];
  if (resolved.name) parts.push(resolved.name);

  if (resolved.address) {
    // Skip address if identical to name (case-insensitive)
    const nameMatch = resolved.name && resolved.address.toLowerCase() === resolved.name.toLowerCase();
    if (!nameMatch) parts.push(resolved.address);
  }

  if (resolved.city) {
    // Skip city if it's a substring of already-joined prior parts
    const priorText = parts.join(", ").toLowerCase();
    if (!priorText.includes(resolved.city.toLowerCase())) {
      parts.push(resolved.city);
    }
  }

  if (resolved.state) {
    // Skip state if it appears as a word-boundary match in prior parts
    // (word boundary prevents "NY" matching inside "DANNY")
    const priorText = parts.join(", ");
    const stateRe = new RegExp(`\\b${resolved.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!stateRe.test(priorText)) {
      parts.push(resolved.state);
    }
  }

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

    const baseUrl = `https://www.meetup.com/${encodeURIComponent(config.groupUrlname)}/events/`;
    const pastUrl = `${baseUrl}?type=past`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // Fetch upcoming + past pages in parallel
    const [upcomingResult, pastResult] = await Promise.allSettled([
      safeFetch(baseUrl, { headers }),
      safeFetch(pastUrl, { headers }),
    ]);

    // Upcoming page must succeed (fatal)
    if (upcomingResult.status === "rejected") {
      const message = `Failed to fetch Meetup events: ${upcomingResult.reason instanceof Error ? upcomingResult.reason.message : String(upcomingResult.reason)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: baseUrl, message }] } };
    }
    const upcomingRes = upcomingResult.value;
    if (!upcomingRes.ok) {
      const message = `Meetup page error ${upcomingRes.status} for group "${config.groupUrlname}"`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: baseUrl, status: upcomingRes.status, message }] },
      };
    }
    const upcomingHtml = await upcomingRes.text();
    const { events: upcomingEvents, state: upcomingState } = extractApolloEvents(upcomingHtml);

    // Past page is non-fatal
    let pastEvents: ApolloEvent[] = [];
    let pastState: Record<string, Record<string, unknown>> = {};
    if (pastResult.status === "fulfilled" && pastResult.value.ok) {
      const pastHtml = await pastResult.value.text();
      const extracted = extractApolloEvents(pastHtml);
      pastEvents = extracted.events;
      pastState = extracted.state;
    }

    // Merge Apollo states (upcoming takes priority for shared keys)
    const mergedState = { ...pastState, ...upcomingState };

    // Deduplicate events by id (upcoming takes priority)
    const upcomingIds = new Set(upcomingEvents.map((ev) => ev.id));
    const allApolloEvents = [
      ...upcomingEvents,
      ...pastEvents.filter((ev) => !upcomingIds.has(ev.id)),
    ];

    if (allApolloEvents.length === 0) {
      const message = "No events found in __NEXT_DATA__ Apollo state";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    for (const [i, ev] of allApolloEvents.entries()) {
      try {
        if (!ev.dateTime) continue;

        const eventDate = new Date(ev.dateTime);
        if (eventDate < minDate || eventDate > maxDate) continue;

        events.push(buildRawEventFromApollo(ev, mergedState, config.kennelTag));
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
      diagnosticContext: {
        groupUrlname: config.groupUrlname,
        eventsFound: allApolloEvents.length,
        upcomingEventsFound: upcomingEvents.length,
        pastEventsFound: pastEvents.length,
      },
    };
  }
}
