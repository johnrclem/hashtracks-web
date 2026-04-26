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

      let hares = stripTba(hcEvent.hares);
      const location = composeHcLocation(hcEvent.locationOneLineDesc, hcEvent.resolvableLocation);

      // Data-entry safety net: when a kennel user pastes the same text into
      // both the hare and location slots (observed on Tokyo H3 #2578, where
      // both fields came back as "JR Keihintohoku line"), the hare slot is
      // almost certainly the wrong one — you don't name a hare after a
      // subway line. Null the hare but keep location; if the location text
      // is also bad, the separate location-quality audit rules will flag
      // it without this adapter erasing a potentially-valid value. See #521.
      if (hares && location && hares.trim().toLowerCase() === location.trim().toLowerCase()) {
        hares = undefined;
      }

      // Intentionally no sourceUrl: the hashruns.org Flutter UI can no longer
      // resolve `https://www.hashruns.org/#/event/${publicEventId}` links
      // (#706, #725). The REST API still serves the UUIDs so scrapes succeed,
      // but the user-facing detail page is dead. Event detail pages fall back
      // to the kennel website / other EventLinks when sourceUrl is null.
      const raw: RawEventData = {
        date: dateStr,
        kennelTag,
        title: hcEvent.eventName || undefined,
        // Socials / "drinking practices" come back as eventNumber=0. Map that
        // sentinel to null (explicit clear) and positive values to the number;
        // anything else stays undefined so the merge UPDATE path preserves an
        // existing runNumber on partial HC payloads (#892).
        runNumber: normalizeHcEventNumber(hcEvent.eventNumber),
        startTime,
        hares,
        location,
        latitude: hcEvent.syncLat != null ? hcEvent.syncLat : undefined,
        longitude: hcEvent.syncLong != null ? hcEvent.syncLong : undefined,
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

/**
 * Trim input and drop padded/case-variant "TBA" placeholders. Must run BEFORE
 * any merge-path comparison so " TBA ", "tba\n", etc. don't survive as a
 * defined string and overwrite a valid existing value via the UPDATE path.
 */
function stripTba(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && !/^tba$/i.test(trimmed) ? trimmed : undefined;
}

/**
 * Map HC eventNumber to RawEvent.runNumber tri-state:
 *   0        → null      (explicit clear: social / drinking practice)
 *   positive → number    (normal run)
 *   other    → undefined (preserve existing value through merge)
 */
function normalizeHcEventNumber(n: number | undefined | null): number | null | undefined {
  if (n === 0) return null;
  if (typeof n === "number" && n > 0) return n;
  return undefined;
}

/**
 * Compose a location string from HC's two location fields.
 *
 * `locationOneLineDesc` is typically the venue/place name ("Iron Horse Tavern").
 * `resolvableLocation` is the full street address when set
 * ("140 High Street, Morgantown, 26505-5413, WV, United States"), but for
 * kennels without a geocoded venue it's either a bare coordinate pair
 * ("35.713..., 139.704...") or a duplicate of the place name.
 *
 * Prefer "{place}, {full address}" when both fields carry real, distinct data
 * so hashers get street-level context in addition to the venue name (#907).
 */
export function composeHcLocation(
  placeName: string | undefined,
  resolvable: string | undefined,
): string | undefined {
  const place = stripTba(placeName);
  const full = stripTba(resolvable);

  // resolvableLocation is a bare coordinate pair for venues Harrier Central
  // couldn't geocode — not useful as user-facing text.
  const coordsOnly = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
  const addressShaped = full && !coordsOnly.test(full) ? full : undefined;

  if (!place && !addressShaped) return undefined;
  if (!addressShaped) return place;
  if (!place) return addressShaped;
  if (place === addressShaped) return place;
  // Drop place when it duplicates the address — either as a complete comma
  // segment (e.g. place "Morgantown" inside "...Morgantown, WV") or as a
  // leading prefix of the address (e.g. place "227 Spruce Street, Morgantown"
  // inside the same fully-formed address). Avoids substring false positives
  // like place "Iron Horse" being dropped because "Iron Horse Tavern Road"
  // appears in the street segment.
  const placeLc = place.toLowerCase();
  const addressLc = addressShaped.toLowerCase();
  const segments = addressLc.split(",").map((s) => s.trim());
  if (segments.includes(placeLc)) return addressShaped;
  if (addressLc.startsWith(`${placeLc},`)) return addressShaped;
  return `${place}, ${addressShaped}`;
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
