import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { generateAccessToken, PUBLIC_HASHER_ID } from "./token";
import { safeFetch } from "../safe-fetch";
import { buildDateWindow, eqTrimLc } from "../utils";

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
  /**
   * Human-readable fallback when an event's `eventName` is empty or matches
   * `staleTitleAliases`. Combined with `eventNumber` to produce e.g.
   * "Tokyo H3 Trail #2580". Mirrors the GCal `defaultTitle` pattern. (#1166)
   */
  defaultTitle?: string;
  /**
   * Title strings (case-insensitive, trimmed) that aren't real trail names —
   * typically neighborhood / station names that surface from kennels who use
   * the location field as a working title (Tokyo H3: "Ikebukuro", "Akabane").
   * Matched events have title replaced by `${defaultTitle} #${eventNumber}`,
   * or cleared to undefined when no defaultTitle is configured. (#1166)
   */
  staleTitleAliases?: readonly string[];
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

      let hares = stripPlaceholderHares(hcEvent.hares);
      const location = composeHcLocation(
        hcEvent.locationOneLineDesc,
        hcEvent.resolvableLocation,
        hcEvent.eventCityAndCountry,
      );

      // Data-entry safety net: when a kennel user pastes the same text into
      // both the hare and location slots (observed on Tokyo H3 #2578, where
      // both fields came back as "JR Keihintohoku line"), the hare slot is
      // almost certainly the wrong one — you don't name a hare after a
      // subway line. Null the hare but keep location; if the location text
      // is also bad, the separate location-quality audit rules will flag
      // it without this adapter erasing a potentially-valid value. See #521.
      // #1642 extension: also strip when the hare text is a prefix/substring
      // of the location AND looks address-shaped (contains a comma, a
      // street-type token, or a leading street number). SG Sunday H3 #798
      // had hares "Swiss Club Road, dead end old Turf City" and location
      // "Swiss Club Road, dead end old Turf City, Singapore" — the location
      // is just the hares value with ", Singapore" appended, but exact-match
      // didn't catch it.
      if (hares && location && haresLooksLikeLocation(hares, location)) {
        hares = undefined;
      }
      // #2408 Tokyo #2591: the hare slot byte-equals the raw venue/neighborhood
      // ("Azabujuban"). The composed-location check above misses it (a single
      // word with no address signals isn't caught once ", Tokyo, Japan" is
      // appended), so compare against the raw place text too.
      if (hares && haresEqualsRawPlace(hares, hcEvent.locationOneLineDesc, hcEvent.resolvableLocation)) {
        hares = undefined;
      }

      // When HC's geocoder fails it returns the placeName verbatim as
      // resolvableLocation and falls back to a region-default lat/lng (e.g.
      // 35.685, 139.751 — the Imperial Palace area — for any un-geocoded
      // Tokyo event, ~10 km from the actual meeting point). Drop those
      // coords and let the merge pipeline geocode from the place text +
      // kennel country bias instead. The match is intentionally
      // case-insensitive on trimmed values to catch the common form (#957).
      const dropApiCoords = hcGeocodeFailed(
        hcEvent.locationOneLineDesc,
        hcEvent.resolvableLocation,
      );

      // Intentionally no sourceUrl: the hashruns.org Flutter UI can no longer
      // resolve `https://www.hashruns.org/#/event/${publicEventId}` links
      // (#706, #725). The REST API still serves the UUIDs so scrapes succeed,
      // but the user-facing detail page is dead. Event detail pages fall back
      // to the kennel website / other EventLinks when sourceUrl is null.
      let title = applyTitleFallback(hcEvent.eventName, hcEvent.eventNumber, config);
      // #2409 Tokyo #2583: the source stored the hare's hash name ("Back Door
      // Hoe") as BOTH the title and the hares field; #2591 stored the
      // neighborhood ("Azabujuban") as both title and venue. A title that
      // byte-equals the hares or the raw venue is never a real run title —
      // re-route through the stale-title fallback ("<defaultTitle> #N", or
      // undefined → merge synthesizes "<Kennel> Trail #N"). hares is kept.
      if (
        title &&
        (eqTrimLc(title, hares) ||
          eqTrimLc(title, hcEvent.locationOneLineDesc) ||
          eqTrimLc(title, hcEvent.resolvableLocation))
      ) {
        title = staleTitleFallback(hcEvent.eventNumber, config);
      }

      const raw: RawEventData = {
        date: dateStr,
        kennelTags: [kennelTag],
        title,
        // Socials / "drinking practices" come back as eventNumber=0. Map that
        // sentinel to null (explicit clear) and positive values to the number;
        // anything else stays undefined so the merge UPDATE path preserves an
        // existing runNumber on partial HC payloads (#892).
        runNumber: normalizeHcEventNumber(hcEvent.eventNumber),
        startTime,
        hares,
        location,
        latitude: dropApiCoords ? undefined : (hcEvent.syncLat != null ? hcEvent.syncLat : undefined),
        longitude: dropApiCoords ? undefined : (hcEvent.syncLong != null ? hcEvent.syncLong : undefined),
        // Tell the merge pipeline to bypass its existingCoords cache and
        // re-geocode this event — without this signal, canonical events
        // already storing HC's bad fallback pin would never be corrected
        // because HC events have locationUrl === null and the cache short-
        // circuit keys on (locationUrl unchanged + stored coords present).
        // See #957 codex review.
        ...(dropApiCoords ? { dropCachedCoords: true } : {}),
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

// Harrier Central appends a system entry — "Placeholder user for visitors /
// virgins for <KennelName>" — to the comma-joined hares string for kennels that
// pre-create biweekly slots (Lisbon H3 #1017, #2220). It is not a real hare and
// must not leak into haresText. Split the comma-joined value, drop placeholder
// entries, and rejoin; returns undefined when nothing real remains.
const PLACEHOLDER_HARE_RE = /\bplaceholder user\b/i;
function stripPlaceholderHares(value: string | undefined): string | undefined {
  const trimmed = stripTba(value);
  if (!trimmed) return undefined;
  // Fast path: no placeholder present → return the trimmed value byte-for-byte
  // (identical to the old stripTba behavior). Re-joining unconditionally would
  // normalize comma spacing ("A,B" → "A, B") and re-fingerprint every HC
  // multi-hare event on the first post-deploy scrape (hares is in the RawEvent
  // fingerprint — see pipeline/fingerprint.ts). Only the rare placeholder case
  // pays the split/rejoin.
  if (!PLACEHOLDER_HARE_RE.test(trimmed)) return trimmed;
  const kept = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !PLACEHOLDER_HARE_RE.test(s));
  return kept.length ? kept.join(", ") : undefined;
}

// Placeholder location strings that HC surfaces when a kennel hasn't set a real
// venue (per-run venues announced day-of). They are NOT geocodable, so HC's
// accompanying syncLat/syncLong are its region-default fallback pin — the same
// "bad coords" case as the place===resolvable duplicate below. Treated as
// geocode failures so the merge pipeline re-geocodes from the kennel's region
// centroid instead of storing the fake pin, AND dropped from the composed
// location text (composeHcLocation) so the placeholder never reaches the UI or
// the geocoder as meaningless input. Lisbon H3 ("No location provided", "TBD",
// "ANNOUNCED LATER via Hares") motivated this; "tbc"/"to be confirmed"/"to be
// announced" are included pre-emptively (ubiquitous on UK/Ireland HC kennels).
// Set lookup (not regex) keeps Sonar S5843/S5852 clear.
const GEOCODE_FAIL_SENTINELS = new Set([
  "tbd",
  "tbc",
  "to be determined",
  "to be confirmed",
  "to be announced",
  "no location provided",
  "announced later via hares",
]);

function isGeocodeSentinel(value: string | undefined): boolean {
  return value ? GEOCODE_FAIL_SENTINELS.has(value.trim().toLowerCase()) : false;
}

/** Trimmed value with TBA *and* placeholder sentinels dropped to undefined. */
function stripPlaceholderLocation(value: string | undefined): string | undefined {
  const trimmed = stripTba(value);
  return isGeocodeSentinel(trimmed) ? undefined : trimmed;
}

// Street-type tokens used by haresLooksLikeLocation to flag address-shaped
// haresText. Stored as a Set + word-split (rather than a long regex
// alternation) to keep Sonar S5843 regex complexity low and let us extend
// the list without touching parse code.
//
// Intentionally narrower than a full USPS abbreviation table: "park" and
// "court" are common in hash names (Park, Park Avenue Slut, Just Court),
// "way" appears in nicknames, and bare directionals (N/S/E/W) are too
// short. Stick to terms that are unambiguous as road suffixes.
const ADDRESS_TOKENS = new Set([
  "road", "rd",
  "street", "st",
  "avenue", "ave",
  "lane", "ln",
  "drive", "dr",
  "boulevard", "blvd",
  "highway", "hwy",
]);

function hasAddressToken(text: string): boolean {
  for (const token of text.toLowerCase().split(/[\s,]+/)) {
    if (token && ADDRESS_TOKENS.has(token)) return true;
  }
  return false;
}

/**
 * #521 + #1642: detect when the source pasted address/location text into
 * the Hares slot. Trigger shapes (intentionally narrow — false positives
 * silently nullify real hare data):
 *
 *  1. Exact case-insensitive match of hares against location (Tokyo
 *     #2578 reproduction).
 *  2. Hares is a substring of location AND has TWO independent address
 *     signals — the substring inclusion alone is not enough. Real hare
 *     names like "Park" or "George Park" routinely substring-match
 *     legitimate location text ("Central Park", "George Park Bar")
 *     without being addresses.
 *
 *     Address signals counted: presence of a comma; leading digit (street
 *     number); contains a narrow street-type token (Road/St/Ave/Lane/
 *     Drive/Blvd/Hwy). Requiring two means a bare "Park" / "Court" / etc.
 *     never trips the heuristic, but the SG Sunday H3 #798 case ("Swiss
 *     Club Road, dead end old Turf City" — comma + "Road") still does.
 */
function haresLooksLikeLocation(hares: string, location: string): boolean {
  const h = hares.trim().toLowerCase();
  const l = location.trim().toLowerCase();
  if (!h || !l) return false;
  if (h === l) return true;
  if (!l.includes(h)) return false;
  // #2021: the location is exactly the hares value plus a trailing
  // comma-separated suffix (the appended eventCityAndCountry). SG Sunday H3
  // #799 had hares "CO Blk 317A Jurong East Str 31" and location
  // "CO Blk 317A Jurong East Str 31, Singapore" — zero road-token signals
  // (neither "blk" nor "str" are in ADDRESS_TOKENS), so the heuristic below
  // missed it. Requiring the hares to be multi-word keeps single-word hash
  // names ("Park", "George") safe: a multi-word hare being an exact
  // comma-prefix of its own venue is effectively impossible.
  if (h.includes(" ") && l.startsWith(h + ",")) return true;
  let signals = 0;
  if (h.includes(",")) signals++;
  if (/^\d/.test(h)) signals++;
  if (hasAddressToken(h)) signals++;
  return signals >= 2;
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
 * Detect HC API geocode failure: when `resolvableLocation` is just a verbatim
 * copy of `locationOneLineDesc` (case-insensitive after trim, both non-empty
 * and not TBA), the upstream API failed to resolve a real address and the
 * accompanying `syncLat`/`syncLong` are HC's region-default fallback coords.
 * Used to gate dropping the API coords so the merge pipeline can geocode from
 * place text + kennel country bias instead. See #957.
 */
export function hcGeocodeFailed(
  placeName: string | undefined,
  resolvable: string | undefined,
): boolean {
  const place = stripTba(placeName);
  const full = stripTba(resolvable);
  // A placeholder sentinel in either field means HC has no real venue (e.g.
  // an empty place + resolvable "No location provided"); its coords are the
  // region-default pin. Check before the both-non-empty guard so placeholder
  // rows with an empty place still drop their coords.
  if (isGeocodeSentinel(place) || isGeocodeSentinel(full)) return true;
  if (!place || !full) return false;
  return place.trim().toLowerCase() === full.trim().toLowerCase();
}

/**
 * Apply title fallback rules from HarrierCentralConfig.
 *
 * Returns the synthesized "{defaultTitle} #{eventNumber}" when:
 *   - eventName is empty/missing OR matches a `staleTitleAliases` entry, AND
 *   - `defaultTitle` is configured AND `eventNumber > 0`.
 * Returns `undefined` when an alias matches but no `defaultTitle` is set
 * (so the canonical event renders via UI's run-number fallback).
 * Otherwise returns the trimmed `eventName` unchanged.
 *
 * #1166 — Tokyo H3 surfaces neighborhood names ("Ikebukuro", "Akabane") as
 * eventName; this lets the source seed a fixed list of placeholder strings
 * to substitute without touching adapter code each time a new one appears.
 */
// Trim trailing separators a source occasionally leaves when a title subfield is
// blank: "…Anniversary |" (Shanghai H3 #2194), the trailing-dash (#756) and
// trailing-colon (#1060) family. Single char class + `+` anchored to `$` →
// linear in input length. Terminal-only: titles ending in "!"/"?" are untouched.
const TITLE_SEPARATOR_TAIL_RE = /[\s|,:–—-]+$/; // NOSONAR S5852 — single char class anchored to `$`, no alternation
function stripTrailingTitleSeparators(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.replace(TITLE_SEPARATOR_TAIL_RE, "").trim() || undefined;
}

/**
 * #2408 Tokyo #2591: the source pasted the neighborhood/station name into the
 * hares slot, byte-equal to the raw venue ("Azabujuban" in hares, title AND
 * location). `haresLooksLikeLocation` compares against the *composed* location
 * ("Azabujuban, Tokyo, Japan"), which a bare single-word place doesn't trip (no
 * address signals). Catch the exact-match-to-raw-place case here.
 */
function haresEqualsRawPlace(
  hares: string,
  placeName: string | undefined,
  resolvable: string | undefined,
): boolean {
  return eqTrimLc(hares, placeName) || eqTrimLc(hares, resolvable);
}

/** Stale-title fallback — "<defaultTitle> #N" when configured, else undefined.
 *  Shared by applyTitleFallback and the #2409 title-equals-hares/place guard. */
function staleTitleFallback(
  eventNumber: number | undefined | null,
  config: HarrierCentralConfig,
): string | undefined {
  if (config.defaultTitle && typeof eventNumber === "number" && eventNumber > 0) {
    return `${config.defaultTitle} #${eventNumber}`;
  }
  return undefined;
}

export function applyTitleFallback(
  eventName: string | undefined,
  eventNumber: number | undefined | null,
  config: HarrierCentralConfig,
): string | undefined {
  const trimmed = stripTrailingTitleSeparators(eventName);
  const aliases = config.staleTitleAliases;
  const isStale =
    !trimmed ||
    (aliases?.some((a) => a.trim().toLowerCase() === trimmed.toLowerCase()) ?? false);

  if (!isStale) return trimmed || undefined;

  return staleTitleFallback(eventNumber, config);
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
 *
 * `cityCountry` is `eventCityAndCountry` from the HC payload (e.g. "Tokyo, Japan").
 * Appended ONLY when HC's geocoder failed (place === resolvable) AND the
 * city/country isn't already present in the place text. Gives the merge-
 * pipeline geocoder enough context to resolve a transit-prose place like
 * "JR Keihintohoku line, Akabane station, North Exit" to the correct city
 * instead of falling back to a region-default pin (#1167).
 */
// #2376 Bandung: some kennels paste the run title into HC's free-text venue
// field ("BHHH2 Run 2288 at Gd. Abadi, Lembang", "BHHH2 Run 2292: Gd. BHHH2,
// Panorama, Lembang") — sometimes with a WRONG run number glued on (#2298 stored
// "Run 2292" on run #2298). Strip a leading "[code] Run <digits> at|:" prefix so
// only the venue remains. Only fires when the place literally starts with that
// shape, so a real venue is untouched. ReDoS-safe: no `\s*` adjacent to the
// at/colon alternation.
const RUN_TITLE_LOCATION_PREFIX_RE = /^(?:\S+\s+)?run\s+\d+(?:\s+at\b|:)\s*/i; // NOSONAR S5852/S5843 — bounded, single quantifiers, no overlapping alternation
function stripRunTitleLocationPrefix(place: string | undefined): string | undefined {
  if (!place) return place;
  // When the venue was ONLY the run-title prefix (nothing after it), return
  // undefined rather than the original bad string — composeHcLocation then falls
  // back to the resolvable address instead of storing "Run 2288 at".
  return place.replace(RUN_TITLE_LOCATION_PREFIX_RE, "").trim() || undefined;
}

export function composeHcLocation(
  placeName: string | undefined,
  resolvable: string | undefined,
  cityCountry?: string | undefined,
): string | undefined {
  // Drop TBA *and* placeholder sentinels ("No location provided", "TBD", etc.)
  // so a non-venue never reaches event.location — otherwise the merge path
  // stores it verbatim and the geocoder treats it as meaningless text (the
  // Lisbon H3 case). Leaving it undefined lets the event render unlocated.
  const place = stripRunTitleLocationPrefix(stripPlaceholderLocation(placeName));
  const full = stripPlaceholderLocation(resolvable);

  // resolvableLocation is a bare coordinate pair for venues Harrier Central
  // couldn't geocode — not useful as user-facing text.
  const coordsOnly = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
  const addressShaped = full && !coordsOnly.test(full) ? full : undefined;

  if (!place && !addressShaped) return undefined;
  if (!addressShaped) return place;
  if (!place) return addressShaped;
  if (place === addressShaped) return appendCityCountry(place, cityCountry);
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

/**
 * Append `, ${cityCountry}` to `place` when the city/country isn't already
 * a substring of place (case-insensitive). Used to enrich transit-prose
 * place names like "JR Keihintohoku line" with city context for the
 * downstream geocoder. See #1167.
 */
function appendCityCountry(
  place: string | undefined,
  cityCountry: string | undefined,
): string | undefined {
  if (!place) return place;
  const cc = cityCountry?.trim();
  if (!cc) return place;
  // Skip the append when ANY comma-segment of cityCountry already appears
  // as a contiguous word sequence inside place. Tokenize both sides so
  // multi-word cities like "Hong Kong" / "Kuala Lumpur" / "New York" match
  // when the place text already names them. Catches both the full
  // form ("...Tokyo, Japan") and the common partial form ("Shibuya, Tokyo").
  const placeTokens = place.toLowerCase().split(/\W+/).filter(Boolean);
  const placeTokenSet = new Set(placeTokens);
  const ccSegments = cc.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const segmentInPlace = (seg: string) => {
    const segTokens = seg.split(/\W+/).filter(Boolean);
    if (segTokens.length === 0) return false;
    if (segTokens.length === 1) return placeTokenSet.has(segTokens[0]);
    // Multi-word: scan placeTokens for the contiguous subsequence.
    for (let i = 0; i + segTokens.length <= placeTokens.length; i++) {
      let hit = true;
      for (let j = 0; j < segTokens.length; j++) {
        if (placeTokens[i + j] !== segTokens[j]) { hit = false; break; }
      }
      if (hit) return true;
    }
    return false;
  };
  if (ccSegments.some(segmentInPlace)) return place;
  return `${place}, ${cc}`;
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
