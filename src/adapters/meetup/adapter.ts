import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { validateSourceConfig } from "../utils";

export interface MeetupConfig {
  groupUrlname: string; // Meetup group URL name, e.g. "brooklyn-hash-house-harriers"
  kennelTag: string; // Kennel shortName to assign all events to
}

interface MeetupEvent {
  id: string;
  name: string;
  status: string;
  time: number; // Unix ms timestamp
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

    const days = options?.days ?? 90;
    const now = new Date();
    const maxDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const errorDetails: ErrorDetails = {};
    const events: RawEventData[] = [];
    const errors: string[] = [];

    // Meetup API v3 — no API key needed for public groups
    const apiUrl = `https://api.meetup.com/${encodeURIComponent(config.groupUrlname)}/events?status=upcoming,past&page=100&only=id,name,status,time,duration,description,venue,link`;

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

    for (const ev of rawEvents) {
      try {
        const eventDate = new Date(ev.time);
        // Filter to window
        if (eventDate > maxDate) continue;

        // YYYY-MM-DD at UTC noon (consistent with platform convention)
        const dateStr = eventDate.toISOString().slice(0, 10);

        // Start time as HH:MM in local time (UTC for now — no timezone from API without OAuth)
        const hours = String(eventDate.getUTCHours()).padStart(2, "0");
        const mins  = String(eventDate.getUTCMinutes()).padStart(2, "0");
        const startTime = `${hours}:${mins}`;

        // Location: prefer "venue name, address, city" — fall back to just city
        let location: string | undefined;
        if (ev.venue) {
          const parts = [ev.venue.name, ev.venue.address_1, ev.venue.city, ev.venue.state]
            .filter(Boolean);
          if (parts.length > 0) location = parts.join(", ");
        }

        // Strip HTML tags from description
        const description = ev.description
          ? ev.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) || undefined
          : undefined;

        events.push({
          date: dateStr,
          kennelTag: config.kennelTag,
          title: ev.name || undefined,
          description,
          location,
          startTime,
          sourceUrl: ev.link,
        });
      } catch (err) {
        const msg = `Failed to parse event "${ev.id}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        errorDetails.parse = [...(errorDetails.parse ?? []), { row: 0, error: msg }];
      }
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: { groupUrlname: config.groupUrlname, eventsFound: rawEvents.length },
    };
  }
}
