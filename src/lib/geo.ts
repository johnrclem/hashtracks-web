/**
 * Geographic utilities: coordinate extraction from Maps URLs, region centroids,
 * and region pin colors for map rendering.
 */

/** Extract lat/lng from a Google Maps URL. Returns null if not parseable. */
export function extractCoordsFromMapsUrl(url: string): { lat: number; lng: number } | null {
  if (!url) return null;

  try {
    // Pattern 1a: !3d...!4d... place coordinates (precise pin location in Google Maps data segment)
    // e.g. ...!3d40.7103089!4d-74.0165895... — always prefer over @lat,lng which is viewport center
    const placeMatch = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
    if (placeMatch) {
      const lat = Number.parseFloat(placeMatch[1]);
      const lng = Number.parseFloat(placeMatch[2]);
      if (isValidCoords(lat, lng)) return { lat, lng };
    }

    // Pattern 1b: @lat,lng,zoom path segment (viewport center — less precise than !3d/!4d)
    // e.g. https://www.google.com/maps/place/Name/@40.748,-73.985,17z
    const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (atMatch) {
      const lat = Number.parseFloat(atMatch[1]);
      const lng = Number.parseFloat(atMatch[2]);
      if (isValidCoords(lat, lng)) return { lat, lng };
    }

    const parsedUrl = new URL(url);

    // Pattern 2: ?q=lat,lng (query with raw numeric coords — not a place name)
    // e.g. https://maps.google.com/?q=40.748,-73.985
    const q = parsedUrl.searchParams.get("q");
    if (q) {
      const qMatch = q.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
      if (qMatch) {
        const lat = Number.parseFloat(qMatch[1]);
        const lng = Number.parseFloat(qMatch[2]);
        if (isValidCoords(lat, lng)) return { lat, lng };
      }
    }

    // Pattern 3: ll=lat,lng (legacy format)
    // e.g. https://maps.google.com/maps?ll=40.748,-73.985
    const ll = parsedUrl.searchParams.get("ll");
    if (ll) {
      const llMatch = ll.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
      if (llMatch) {
        const lat = Number.parseFloat(llMatch[1]);
        const lng = Number.parseFloat(llMatch[2]);
        if (isValidCoords(lat, lng)) return { lat, lng };
      }
    }

    // Pattern 4: query=lat,lng (used by several adapters for precise coords)
    // e.g. https://www.google.com/maps/search/?api=1&query=40.748,-73.985
    const query = parsedUrl.searchParams.get("query");
    if (query) {
      const queryMatch = query.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
      if (queryMatch) {
        const lat = Number.parseFloat(queryMatch[1]);
        const lng = Number.parseFloat(queryMatch[2]);
        if (isValidCoords(lat, lng)) return { lat, lng };
      }
    }
  } catch {
    // URL parsing failed
    return null;
  }

  return null;
}

/** DMS coordinate pattern: `34°08'52.8"N 112°22'05.6"W` or `34°08'52.8"N, 112°22'05.6"W` (with optional comma) */
const DMS_PARSE_RE = /(\d{1,3})°(\d{1,2})'([\d.]+)"([NS]),?\s+(\d{1,3})°(\d{1,2})'([\d.]+)"([EW])/;
const DMS_STRIP_RE = /,?\s*\d{1,3}°\d{1,2}'[\d.]+"[NS],?\s+\d{1,3}°\d{1,2}'[\d.]+"[EW]\s*/g;

/**
 * Parse DMS (degrees/minutes/seconds) coordinates from a location string.
 * e.g., `34°08'52.8"N 112°22'05.6"W` → { lat: 34.1480, lng: -112.3682 }
 * Also accepts comma separator: `34°08'52.8"N, 112°22'05.6"W`
 * Returns null if no DMS pattern found.
 */
export function parseDMSFromLocation(location: string): { lat: number; lng: number } | null {
  const match = DMS_PARSE_RE.exec(location);
  if (!match) return null;

  const latDeg = Number.parseInt(match[1], 10);
  const latMin = Number.parseInt(match[2], 10);
  const latSec = Number.parseFloat(match[3]);
  const latDir = match[4];
  const lngDeg = Number.parseInt(match[5], 10);
  const lngMin = Number.parseInt(match[6], 10);
  const lngSec = Number.parseFloat(match[7]);
  const lngDir = match[8];

  let lat = latDeg + latMin / 60 + latSec / 3600;
  let lng = lngDeg + lngMin / 60 + lngSec / 3600;
  if (latDir === "S") lat = -lat;
  if (lngDir === "W") lng = -lng;

  if (!isValidCoords(lat, lng)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/**
 * Strip DMS coordinate strings from a location, leaving just the venue name and address.
 * e.g., `Fort Misery, 34°08'52.8"N 112°22'05.6"W, Yavapai County` → `Fort Misery, Yavapai County`
 */
export function stripDMSFromLocation(location: string): string {
  return location
    .replace(DMS_STRIP_RE, "")
    .replace(/,\s*,/g, ",")  // collapse double commas
    .replace(/^,\s*|,\s*$/g, "")  // trim leading/trailing commas
    .trim();
}

export function isValidCoords(lat: number, lng: number): boolean {
  if (lat === 0 && lng === 0) return false;
  return !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ── Region centroids & colors (delegated to src/lib/region.ts — single source of truth) ──

import { REGION_SEED_DATA, getRegionCentroid, regionSlug } from "@/lib/region";

/**
 * Region center coordinates for approximate pin fallback.
 * Built from REGION_SEED_DATA. Keyed by name, slug, and aliases.
 */
export const REGION_CENTROIDS: Record<string, { lat: number; lng: number }> = (() => {
  const map: Record<string, { lat: number; lng: number }> = {};
  for (const r of REGION_SEED_DATA) {
    if (r.centroidLat != null && r.centroidLng != null) {
      const coords = { lat: r.centroidLat, lng: r.centroidLng };
      map[r.name] = coords;
      map[regionSlug(r.name)] = coords;
      if (r.aliases) {
        for (const alias of r.aliases) {
          map[alias] = coords;
        }
      }
    }
  }
  return map;
})();

export { getRegionColor, getRegionCentroid, DEFAULT_PIN_COLOR } from "@/lib/region";
// Note: getRegionCentroid is also imported above for local use in getEventCoords

/**
 * Calculates the great-circle distance between two points using the Haversine formula.
 * @returns Distance in kilometres.
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distance filter options in kilometres. */
export const DISTANCE_OPTIONS = [10, 25, 50, 100, 250] as const;

/**
 * Returns coordinates for an event — precise (from DB lat/lng) or approximate (region centroid).
 * Returns null if neither source is available.
 */
export function getEventCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
  region: string,
): { lat: number; lng: number; precise: boolean } | null {
  if (lat != null && lng != null) {
    return { lat, lng, precise: true };
  }
  const centroid = getRegionCentroid(region);
  if (centroid) {
    return { lat: centroid.lat, lng: centroid.lng, precise: false };
  }
  return null;
}

/**
 * Returns coordinates for an event using RegionData directly (no string lookup).
 * Prefer this over getEventCoords when regionData is available.
 */
export function getEventCoordsFromRegionData(
  lat: number | null | undefined,
  lng: number | null | undefined,
  regionData: { centroidLat: number | null; centroidLng: number | null },
): { lat: number; lng: number; precise: boolean } | null {
  if (lat != null && lng != null) {
    return { lat, lng, precise: true };
  }
  if (regionData.centroidLat != null && regionData.centroidLng != null) {
    return { lat: regionData.centroidLat, lng: regionData.centroidLng, precise: false };
  }
  return null;
}

/**
 * Latitude/longitude box containing every point within `radiusKm` of a center,
 * for a cheap SQL prefilter before an exact `haversineDistance` check.
 * Longitude widens with latitude; near the antimeridian (where the box would
 * wrap) it covers every longitude instead.
 */
export function boundingBoxForRadiusKm(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const KM_PER_DEGREE = 111.32;
  const dLat = radiusKm / KM_PER_DEGREE;
  // Clamp so the box stays finite at the poles.
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const dLng = radiusKm / (KM_PER_DEGREE * cosLat);
  const minLng = centerLng - dLng;
  const maxLng = centerLng + dLng;
  const wraps = minLng < -180 || maxLng > 180;
  return {
    minLat: centerLat - dLat,
    maxLat: centerLat + dLat,
    minLng: wraps ? -180 : minLng,
    maxLng: wraps ? 180 : maxLng,
  };
}

/** Hardcoded Google Geocoding API base — not user-controlled (SSRF-safe). */
const GOOGLE_GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Half-width (degrees) of the geocoding viewport bias box. ~0.5° ≈ 55km — wide
 * enough to cover a metro + its suburbs, tight enough to prefer the local
 * landmark over a same-named place in another city.
 */
export const GEOCODE_VIEWPORT_DELTA_DEG = 0.5;

/**
 * Build a SW|NE viewport box centered on a point, for `geocodeAddress`'s
 * `bounds` option (soft-biases results toward the local area). Returns
 * `undefined` for non-finite inputs (NaN/Infinity) so a junk center silently
 * drops the bias rather than emitting a malformed `&bounds=` param. Corners are
 * clamped to valid lat/lng ranges (a center near a pole/antimeridian would
 * otherwise overflow ±90/±180 and be rejected by the Geocoding API).
 */
export function boundingBoxFromCenter(
  centerLat: number,
  centerLng: number,
  halfWidthDeg: number = GEOCODE_VIEWPORT_DELTA_DEG,
): { swLat: number; swLng: number; neLat: number; neLng: number } | undefined {
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng) || !Number.isFinite(halfWidthDeg)) {
    return undefined;
  }
  return {
    swLat: Math.max(-90, centerLat - halfWidthDeg),
    swLng: Math.max(-180, centerLng - halfWidthDeg),
    neLat: Math.min(90, centerLat + halfWidthDeg),
    neLng: Math.min(180, centerLng + halfWidthDeg),
  };
}

/**
 * Venue strings that can never geocode. Skipping them saves a Geocoding API
 * call and the ZERO_RESULTS log line each scrape. Split into small anchored
 * patterns to stay under SonarCloud's regex-complexity budget (S5843):
 *   - TBD/TBA/TBC, optionally punctuated ("TBD.") and optionally followed by a
 *     separator + note ("TBA - Christmas Run") — but not "TBD Brewing";
 *   - bare N/A, none, or "?" runs;
 *   - "see calendar/website/facebook/details/description" pointers.
 * Kept local (not adapters/utils' isPlaceholder) because this module is also
 * bundled for client components.
 */
const GEOCODE_PLACEHOLDER_RES: RegExp[] = [
  /^(?:tbd|tba|tbc)[.!]?(?:\s*[-–:(,].*)?$/i,
  /^(?:n\/a|none|\?+)$/i,
  /^see (?:calendar|website|facebook|details|description)\b/i,
];

function isGeocodePlaceholder(address: string): boolean {
  return GEOCODE_PLACEHOLDER_RES.some((re) => re.test(address));
}

/** One address component of a Google Geocoding result (town, postcode, county…). */
export interface GeocodeComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

/** A forward-geocode hit: the first result's point plus what Google says it is. */
export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress?: string;
  /** Result types, e.g. ["premise", "street_address"], ["route"], ["administrative_area_level_1", "political"]. */
  types?: string[];
  components?: GeocodeComponent[];
}

interface GeocodeApiResult {
  types?: string[];
  formatted_address?: string;
  address_components?: GeocodeComponent[];
  geometry?: { location?: { lat?: unknown; lng?: unknown } };
}

interface GeocodeApiResponse {
  status?: string;
  error_message?: string;
  results?: GeocodeApiResult[];
}

/** GET a Geocoding API URL with a 5 s timeout. Null on a non-2xx response; throws on a network error. */
async function fetchGeocodeJson(url: string): Promise<GeocodeApiResponse | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return res.ok ? ((await res.json()) as GeocodeApiResponse) : null;
}

type GeocodeOptions = {
  regionBias?: string;
  /**
   * Viewport (SW|NE corners) to soft-bias results toward. `region` only
   * disambiguates by country; `bounds` disambiguates *within* a country so
   * terse local landmarks ("Union Station", "Clarendon") resolve to the
   * kennel's metro instead of a same-named place elsewhere. Soft bias — Google
   * still returns better out-of-viewport matches, so legit suburbs survive.
   */
  bounds?: { swLat: number; swLng: number; neLat: number; neLng: number };
};

/**
 * One forward-geocode request. `noMatch` is true only when Google found
 * nothing (ZERO_RESULTS): another query may still work. Key, quota and
 * network failures leave it false so callers stop instead of retrying.
 */
async function geocodeQuery(
  address: string,
  options?: GeocodeOptions,
): Promise<{ result: GeocodeResult | null; noMatch: boolean }> {
  const miss = { result: null, noMatch: false };
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey || !address.trim()) return miss;
  if (isGeocodePlaceholder(address.trim())) return { result: null, noMatch: true };

  try {
    let url = `${GOOGLE_GEOCODE_BASE}?address=${encodeURIComponent(address)}&language=en&key=${apiKey}`;
    if (options?.regionBias) {
      url += `&region=${encodeURIComponent(options.regionBias)}`;
    }
    if (options?.bounds) {
      const b = options.bounds;
      url += `&bounds=${b.swLat},${b.swLng}|${b.neLat},${b.neLng}`;
    }
    const data = await fetchGeocodeJson(url);
    if (!data) return miss;

    const first = data.results?.[0];
    if (data.status !== "OK" || !first) {
      // ZERO_RESULTS is expected for vague venue names ("Chez Crunchy") — warn.
      // Anything else (REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST) points
      // at the API key or quota and stays an error so it surfaces in alerts.
      const noMatch = data.status === "ZERO_RESULTS";
      (noMatch ? console.warn : console.error)(`Geocode failed for "${address}": ${data.status} ${data.error_message ?? ""}`);
      return { result: null, noMatch };
    }

    const lat = first.geometry?.location?.lat;
    const lng = first.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") return { result: null, noMatch: true };
    return {
      result: {
        lat,
        lng,
        formattedAddress: first.formatted_address,
        types: first.types,
        components: first.address_components,
      },
      noMatch: false,
    };
  } catch {
    return miss;
  }
}

/**
 * Geocode a text address using the Google Maps Geocoding API.
 * Returns the first result's coordinates, or null on failure.
 * Uses GOOGLE_CALENDAR_API_KEY (server-only, no HTTP referrer restrictions).
 * For event venues use `geocodeVenue`, which also rejects area and wrong-town hits.
 */
export async function geocodeAddress(address: string, options?: GeocodeOptions): Promise<GeocodeResult | null> {
  return (await geocodeQuery(address, options)).result;
}

/**
 * Result types that name an area, not a place to meet. A state or region
 * centroid is never a trail start: #2908 pinned the placeholder venue
 * "Rhode Island" to the state centroid, then labelled it "North Kingstown".
 */
const AREA_RESULT_TYPES = new Set(["country", "administrative_area_level_1", "colloquial_area"]);

/**
 * Countries whose `administrative_area_level_2` is a county ("Palm Beach
 * County", "Hertfordshire"). Elsewhere level 2 is often a district small
 * enough to be a fair pin (a Thai amphoe, a Taiwan district), so it stays.
 */
const COUNTY_LEVEL_2_COUNTRIES = new Set(["US", "GB"]);

/** Components that put a result inside a town. */
const TOWN_COMPONENT_TYPES = new Set(["locality", "postal_town", "sublocality", "administrative_area_level_3"]);

/**
 * Components whose name can confirm the town a venue's text names. Roads and
 * buildings are left out: a "Church Road" exists in every town.
 */
const PLACE_NAME_TYPES = new Set([
  ...TOWN_COMPONENT_TYPES,
  "neighborhood",
  "administrative_area_level_2",
  "administrative_area_level_4",
]);

/** A venue geocode further than this from the kennel is the wrong city. */
const VENUE_MAX_DISTANCE_KM = 200;

/**
 * A venue geocode further than this from the kennel must be in a town or
 * postcode the venue text names. Google's viewport bias is soft, so a
 * same-named place in another town still wins: "Mount Radford, Exeter"
 * resolved to a house called Mt Radford in Wembdon, 58 km away (#2914).
 */
export const VENUE_TOWN_CHECK_KM = 25;

/** Lowercase, accent- and punctuation-free form for comparing place names. */
function placeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Uppercase with whitespace removed, for finding a postcode inside free text. */
function compact(text: string): string {
  return text.replace(/\s/g, "").toUpperCase();
}

/**
 * Geocoding queries for a venue, best first. A bare pub name ("The Pheasant")
 * matches a same-named pub anywhere in the country, so when the adapter also
 * has a street line (town + postcode) it goes in the query, with the street
 * line alone as the fallback. The bare venue is queried only when there is no
 * street line.
 */
export function buildVenueGeocodeQueries(location?: string | null, street?: string | null): string[] {
  const venue = location?.trim() ?? "";
  const address = street?.trim() ?? "";
  if (!address || isGeocodePlaceholder(address)) return venue ? [venue] : [];
  if (!venue || isGeocodePlaceholder(venue)) return [address];
  const venueKey = placeKey(venue);
  const addressKey = placeKey(address);
  // One line already holds the other ("SRO Lounge, 1807 Fifth Ave, …" as the street).
  if (venueKey && addressKey.includes(venueKey)) return [address];
  if (addressKey && venueKey.includes(addressKey)) return [venue];
  return [`${venue}, ${address}`, address];
}

/**
 * True when the result sits in a town or postcode the venue text names, or
 * the text names neither. Towns are the comma segments of the street line and
 * of the venue line after its first segment (the venue itself), with digits
 * dropped, so a postcode "SG8 9PN" leaves no town behind.
 */
function resultInNamedPlace(
  components: GeocodeComponent[],
  venue: { location?: string | null; street?: string | null },
): boolean {
  const segments = [...(venue.location ?? "").split(",").slice(1), ...(venue.street ?? "").split(",")];
  const towns = segments
    .map((s) => placeKey(s.replace(/\d+/g, " ")))
    // A town has a 3-letter word and few words; longer segments are notes ("park on the verge").
    .filter((key) => /[a-z]{3}/.test(key) && key.split(" ").length <= 3);
  const text = compact(segments.join(" "));
  const postcode = components.find((c) => c.types.includes("postal_code"))?.long_name;
  if (postcode && compact(postcode).length >= 4 && text.includes(compact(postcode))) return true;
  if (towns.length === 0) return !/\d/.test(text);
  const names = components
    .filter((c) => c.types.some((t) => PLACE_NAME_TYPES.has(t)))
    .flatMap((c) => [placeKey(c.long_name), placeKey(c.short_name)])
    .filter((n) => n.length >= 3);
  return towns.some((town) => names.some((name) => name.includes(town) || town.includes(name)));
}

/**
 * Why a forward-geocode result can't be an event venue, or null when it can.
 * Rejects area centroids (state, US/UK county, region), whole roads ("A38, United
 * Kingdom", #2914), anything over `VENUE_MAX_DISTANCE_KM` from the kennel, and
 * anything over `VENUE_TOWN_CHECK_KM` that isn't in a town or postcode the
 * venue text names.
 */
export function venueGeocodeRejection(
  result: GeocodeResult,
  venue: { location?: string | null; street?: string | null },
  biasCenter?: { lat: number; lng: number } | null,
): string | null {
  const types = result.types ?? [];
  const components = result.components ?? [];
  const country = components.find((c) => c.types.includes("country"))?.short_name ?? "";
  const isCounty = types.includes("administrative_area_level_2") && COUNTY_LEVEL_2_COUNTRIES.has(country);
  if (isCounty || types.some((t) => AREA_RESULT_TYPES.has(t))) return `an area, not a venue (${types.join("|")})`;
  const inTown = components.some((c) => c.types.some((t) => TOWN_COMPONENT_TYPES.has(t)));
  if (types.includes("route") && !inTown) return "a whole road, not a venue";
  if (!biasCenter) return null;
  const km = haversineDistance(result.lat, result.lng, biasCenter.lat, biasCenter.lng);
  if (km > VENUE_MAX_DISTANCE_KM) return `${km.toFixed(0)}km from the kennel`;
  if (km > VENUE_TOWN_CHECK_KM && !resultInNamedPlace(components, venue)) {
    return `${km.toFixed(0)}km from the kennel and outside the town the venue names`;
  }
  return null;
}

/**
 * Geocode an event venue with the queries from `buildVenueGeocodeQueries`,
 * each viewport-biased toward `biasCenter` (the kennel) and dropped
 * when `venueGeocodeRejection` flags it. Null when no query yields a usable pin.
 */
export async function geocodeVenue(venue: {
  location?: string | null;
  street?: string | null;
  regionBias?: string;
  biasCenter?: { lat: number; lng: number } | null;
}): Promise<GeocodeResult | null> {
  const { biasCenter } = venue;
  const bounds = biasCenter ? boundingBoxFromCenter(biasCenter.lat, biasCenter.lng) : undefined;
  for (const query of buildVenueGeocodeQueries(venue.location, venue.street)) {
    const { result, noMatch } = await geocodeQuery(query, { regionBias: venue.regionBias, bounds });
    if (!result) {
      if (noMatch) continue;
      return null; // key, quota or network trouble: the next query would fail the same way
    }
    const rejection = venueGeocodeRejection(result, venue, biasCenter);
    if (!rejection) return result;
    console.warn(`Geocode rejected for "${query}": ${result.formattedAddress ?? `${result.lat},${result.lng}`} is ${rejection}`);
  }
  return null;
}

/**
 * Format a town for display: "Brooklyn, NY", "Therfield, England", "Dublin".
 * #968: Google returns admin_area_level_1.short_name = "D" for County Dublin
 * (an Eircode prefix, not a real abbreviation), which produced "Dublin, D".
 * Drop the suffix only for IE so a legitimate 1-char admin code elsewhere
 * (e.g., AR ISO 3166-2) survives.
 */
function formatTown(town: GeocodeComponent, components: GeocodeComponent[]): string {
  const stateShort = components.find((c) => c.types.includes("administrative_area_level_1"))?.short_name;
  const countryShort = components.find((c) => c.types.includes("country"))?.short_name;
  if (!stateShort || (countryShort === "IE" && stateShort.length < 2)) return town.long_name;
  return `${town.long_name}, ${stateShort}`;
}

/** The first locality any address names, else the first postal town. Plus-code results name no town. */
function townFromAddresses(results: GeocodeApiResult[]): string | null {
  const addresses = results.filter((r) => !r.types?.includes("plus_code"));
  for (const type of ["locality", "postal_town"]) {
    for (const address of addresses) {
      const components = address.address_components ?? [];
      const town = components.find((c) => c.types.includes(type));
      if (town) return formatTown(town, components);
    }
  }
  return null;
}

/**
 * Reverse geocode coordinates to a city string using the Google Maps Geocoding API.
 * Returns a display string like "Brooklyn, NY" or "London, England", or null on failure.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey) return null;
  const base = `${GOOGLE_GEOCODE_BASE}?latlng=${lat},${lng}&language=en&key=${apiKey}`;

  try {
    // Town-typed results first, which keeps a borough ("Brooklyn, NY") ahead
    // of the city a street address would name.
    const towns = await fetchGeocodeJson(`${base}&result_type=locality|sublocality`);
    if (!towns) return null;
    if (towns.status === "OK") {
      const components = towns.results?.[0]?.address_components ?? [];
      const town = components.find((c) => c.types.includes("locality") || c.types.includes("sublocality"));
      if (town) return formatTown(town, components);
    } else if (towns.status !== "ZERO_RESULTS") {
      return null; // key or quota trouble: a second request would fail the same way
    }

    // #2860: a village rarely has a town-typed result of its own, so the
    // filtered request comes back empty even though every address there names
    // it ("The Green, Therfield, Royston SG8 9PN"). Read the town off those.
    const addresses = await fetchGeocodeJson(base);
    return addresses?.status === "OK" ? townFromAddresses(addresses.results ?? []) : null;
  } catch {
    return null;
  }
}

/**
 * Extract a fallback city name from a Strava timezone string.
 * e.g. "(GMT-05:00) America/New_York" → "New York"
 */
export function cityFromTimezone(timezone: string | null): string | null {
  if (!timezone) return null;
  const ianaMatch = /(\w+\/[\w\-/]+)$/.exec(timezone);
  if (!ianaMatch) return null;
  const parts = ianaMatch[1].split("/");
  const city = parts.at(-1)?.replaceAll("_", " ") ?? null;
  return city || null;
}

/**
 * Resolve a Google Maps short URL (maps.app.goo.gl or goo.gl/maps)
 * by following HTTP redirects to get the full URL with coordinates.
 * Returns null if resolution fails or the URL is not a short Maps URL.
 */
export async function resolveShortMapsUrl(
  url: string,
): Promise<string | null> {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const isShortMapsUrl =
      parsed.hostname === "maps.app.goo.gl" ||
      (parsed.hostname === "goo.gl" && parsed.pathname.startsWith("/maps"));
    if (!isShortMapsUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });
      if (res.url === url) return null;
      // Verify the resolved URL is a Google domain (guard against unexpected redirects)
      const resolved = new URL(res.url);
      const isGoogleDomain =
        resolved.hostname.endsWith("google.com") ||
        resolved.hostname.endsWith("google.co.uk") ||
        resolved.hostname.endsWith("goo.gl");
      return isGoogleDomain ? res.url : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}
