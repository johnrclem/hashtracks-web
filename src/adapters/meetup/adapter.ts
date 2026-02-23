import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { validateSourceConfig, stripHtmlTags, buildDateWindow } from "../utils";

export interface MeetupConfig {
  groupUrlname: string; // Meetup group URL name, e.g. "brooklyn-hash-house-harriers"
  kennelTag: string; // Kennel shortName to assign all events to
}

interface MeetupEvent {
  id: string;
  name: string;
  status: string;
  time: number;        // Unix ms timestamp — used only for window filtering
  local_date: string;  // YYYY-MM-DD in the event's local timezone
  local_time: string;  // HH:mm in the event's local timezone
  duration?: number;
  description?: string;
  venue?: {
    name?: string;
    address_1?: string;
    city?: string;
    state?: string;
  };
  link: string;
}

/**
 * Meetup adapter — fetches events from a public Meetup.com group.
 *
 * Uses the Meetup v3 public API: GET /groups/{groupUrlname}/events
 * No API key required for public groups (rate-limited at ~200 req/hr).
 *
 * Config: { groupUrlname: string, kennelTag: string }
 */
/** Build location string from a Meetup venue object. */
function buildLocationFromVenue(venue: MeetupEvent["venue"]): string | undefined {
  if (!venue) return undefined;
  const parts = [venue.name, venue.address_1, venue.city, venue.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Strip HTML tags from Meetup description and truncate. */
function cleanMeetupDescription(desc: string | undefined): string | undefined {
  if (!desc) return undefined;
  return stripHtmlTags(desc).slice(0, 2000) || undefined;
}

/** Build a RawEventData from a single Meetup event. */
function buildRawEventFromMeetupEvent(ev: MeetupEvent, kennelTag: string): RawEventData {
  return {
    date: ev.local_date,
    kennelTag,
    title: ev.name || undefined,
    description: cleanMeetupDescription(ev.description),
    location: buildLocationFromVenue(ev.venue),
    startTime: ev.local_time,
    sourceUrl: ev.link,
  };
}

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

    const apiUrl = `https://api.meetup.com/${encodeURIComponent(config.groupUrlname)}/events?status=upcoming,past&page=100&only=id,name,status,time,local_date,local_time,duration,description,venue,link`;

    let rawEvents: MeetupEvent[];
    try {
      const res = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        const message = `Meetup API error ${res.status} for group "${config.groupUrlname}"`;
        return {
          events: [],
          errors: [message],
          errorDetails: { fetch: [{ url: apiUrl, status: res.status, message }] },
        };
      }

      rawEvents = (await res.json()) as MeetupEvent[];
    } catch (err) {
      const message = `Failed to fetch Meetup events: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: apiUrl, message }] } };
    }

    for (const [i, ev] of rawEvents.entries()) {
      try {
        const eventDate = new Date(ev.time);
        if (eventDate < minDate || eventDate > maxDate) continue;

        events.push(buildRawEventFromMeetupEvent(ev, config.kennelTag));
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
      diagnosticContext: { groupUrlname: config.groupUrlname, eventsFound: rawEvents.length },
    };
  }
}
