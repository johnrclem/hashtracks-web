import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { generateAccessToken, PUBLIC_HASHER_ID } from "./token";
import { safeFetch } from "../safe-fetch";
import { buildDateWindow } from "../utils";

const API_URL = "https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/";

/** Shape of a single event from the Harrier Central getEvents response */
export interface HCEvent {
  publicEventId: string;
  publicKennelId: string;
  kennelName: string;
  kennelShortName: string;
  kennelUniqueShortName: string;
  eventName: string;
  eventNumber: number;
  eventStartDatetime: string; // "2026-04-27T19:15:00"
  syncLat: number;
  syncLong: number;
  locationOneLineDesc: string;
  resolvableLocation: string;
  hares: string;
  eventCityAndCountry: string;
  isVisible: number;
  isCountedRun: number;
  daysUntilEvent: number;
  searchText?: string;
  kennelLogo?: string;
  eventGeographicScope?: number;
  eventChatMessageCount?: number;
  kenPublishToGoogleCalendar?: number;
}

/** Config shape for HARRIER_CENTRAL sources stored in Source.config */
export interface HarrierCentralConfig {
  /** Filter by city name (e.g., "Tokyo", "Seattle") */
  cityNames?: string;
  /** Filter by kennel unique short name (e.g., "TH3") */
  kennelUniqueShortName?: string;
  /** Filter by public kennel GUID */
  publicKennelId?: string;
  /** Default kennel tag for single-kennel sources */
  defaultKennelTag?: string;
  /** Kennel patterns for multi-kennel sources: [["regex", "kennelTag"], ...] */
  kennelPatterns?: [string, string][];
}

/**
 * Harrier Central adapter — fetches events from the Harrier Central public REST API.
 *
 * This is a config-driven adapter (like GOOGLE_CALENDAR or MEETUP):
 * - One adapter class handles all HARRIER_CENTRAL sources
 * - Each Source record specifies which kennels/cities to fetch via Source.config
 * - Token generation uses a time-based SHA-256 HMAC (reverse-engineered from hashruns.org)
 */
export class HarrierCentralAdapter implements SourceAdapter {
  type = "HARRIER_CENTRAL" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const config = (source.config ?? {}) as HarrierCentralConfig;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();

    // Build the API request body
    const accessToken = generateAccessToken("getEvents");
    const body: Record<string, string> = {
      publicHasherId: PUBLIC_HASHER_ID,
      accessToken,
      queryType: "getEvents",
    };

    if (config.cityNames) body.cityNames = config.cityNames;
    if (config.kennelUniqueShortName) body.kennelUniqueShortName = config.kennelUniqueShortName;
    if (config.publicKennelId) body.publicKennelIds = config.publicKennelId; // API param is plural

    // Fetch events from the API
    let hcEvents: HCEvent[];
    try {
      const res = await safeFetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = `Harrier Central API returned HTTP ${res.status}`;
        errorDetails.fetch = [{ url: API_URL, status: res.status, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }

      const json = await res.json() as unknown;
      // API returns [[...events...]] — array wrapped in array
      const outerArray = json as unknown[][];
      if (!Array.isArray(outerArray) || !Array.isArray(outerArray[0])) {
        const msg = "Unexpected API response shape — expected [[events]]";
        errorDetails.fetch = [{ url: API_URL, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }

      hcEvents = outerArray[0] as HCEvent[];

      // Check for API errors (error objects have errorType field)
      if (hcEvents.length > 0 && "errorType" in hcEvents[0]) {
        const err = hcEvents[0] as unknown as { errorTitle: string; errorUserMessage: string };
        const msg = `Harrier Central API error: ${err.errorTitle} — ${err.errorUserMessage}`;
        errorDetails.fetch = [{ url: API_URL, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }
    } catch (err) {
      const msg = `Harrier Central API fetch error: ${err}`;
      errorDetails.fetch = [{ url: API_URL, message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    // HC API returns all future events; days only limits post-fetch filtering
    const days = options?.days ?? source.scrapeDays ?? 365;
    const { maxDate } = buildDateWindow(days);

    // Pre-compile kennel patterns once (avoid per-event RegExp allocation)
    const compiledPatterns = config.kennelPatterns?.map(([pattern, tag]) => {
      try { return [new RegExp(pattern, "i"), tag] as const; }
      catch { return null; }
    }).filter((p): p is [RegExp, string] => p !== null);

    // Convert HC events to RawEventData
    for (const hcEvent of hcEvents) {
      if (!hcEvent.eventStartDatetime) continue;
      if (!hcEvent.isVisible) continue;

      // Timestamps lack TZ offset (e.g., "2026-04-27T19:15:00"); date/time extraction
      // via slice/regex is TZ-safe — only this maxDate comparison uses new Date()
      const eventDate = new Date(hcEvent.eventStartDatetime);
      if (eventDate > maxDate) continue;

      const kennelTag = resolveKennelTag(hcEvent, config, compiledPatterns);
      if (!kennelTag) continue;

      const dateStr = hcEvent.eventStartDatetime.slice(0, 10); // "YYYY-MM-DD"
      const timeMatch = hcEvent.eventStartDatetime.match(/T(\d{2}:\d{2})/);
      const startTime = timeMatch ? timeMatch[1] : undefined;

      let hares = hcEvent.hares && hcEvent.hares !== "TBA" ? hcEvent.hares : undefined;
      const location = hcEvent.locationOneLineDesc && hcEvent.locationOneLineDesc !== "TBA"
        ? hcEvent.locationOneLineDesc
        : undefined;

      // Data-entry safety net: when a kennel user pastes the same text into
      // both the hare and location slots (observed on Tokyo H3 #2578, where
      // both fields came back as "JR Keihintohoku line"), the hare slot is
      // almost certainly the wrong one — you don't name a hare after a
      // subway line. Null the hare but keep location; if the location text
      // is also bad, the separate location-quality audit rules will flag
      // it without this adapter erasing a potentially-valid value. See #521.
      if (hares && location && hares.trim() === location.trim()) {
        hares = undefined;
      }

      const raw: RawEventData = {
        date: dateStr,
        kennelTag,
        title: hcEvent.eventName || undefined,
        runNumber: hcEvent.eventNumber != null ? hcEvent.eventNumber : undefined,
        startTime,
        hares,
        location,
        latitude: hcEvent.syncLat != null ? hcEvent.syncLat : undefined,
        longitude: hcEvent.syncLong != null ? hcEvent.syncLong : undefined,
        sourceUrl: `https://www.hashruns.org/#/event/${hcEvent.publicEventId}`,
      };

      events.push(raw);
    }

    return {
      events,
      errors,
      ...(hasAnyErrors(errorDetails) ? { errorDetails } : {}),
      diagnosticContext: {
        fetchDurationMs: Date.now() - fetchStart,
        apiEventsReturned: hcEvents.length,
        eventsEmitted: events.length,
      },
    };
  }
}

/** Resolve kennel tag from HC event using pre-compiled config patterns */
function resolveKennelTag(
  event: HCEvent,
  config: HarrierCentralConfig,
  compiledPatterns?: readonly [RegExp, string][],
): string | null {
  if (compiledPatterns?.length) {
    const searchText = `${event.kennelName} ${event.kennelShortName} ${event.kennelUniqueShortName}`;
    for (const [re, tag] of compiledPatterns) {
      if (re.test(searchText)) return tag;
    }
  }

  if (config.defaultKennelTag) return config.defaultKennelTag;

  // Last resort: use API's kennelUniqueShortName (will trigger SOURCE_KENNEL_MISMATCH if not seeded)
  return event.kennelUniqueShortName || null;
}
