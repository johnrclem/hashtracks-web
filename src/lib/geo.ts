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

function isValidCoords(lat: number, lng: number): boolean {
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

/** Hardcoded Google Geocoding API base — not user-controlled (SSRF-safe). */
const GOOGLE_GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Geocode a text address using the Google Maps Geocoding API.
 * Returns the first result's coordinates, or null on failure.
 * Uses GOOGLE_CALENDAR_API_KEY (server-only, no HTTP referrer restrictions).
 */
export async function geocodeAddress(
  address: string,
  options?: { regionBias?: string },
): Promise<{ lat: number; lng: number; formattedAddress?: string } | null> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey || !address.trim()) return null;

  try {
    let url = `${GOOGLE_GEOCODE_BASE}?address=${encodeURIComponent(address)}&language=en&key=${apiKey}`;
    if (options?.regionBias) {
      url += `&region=${encodeURIComponent(options.regionBias)}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) {
      console.error(`Geocode failed for "${address}": ${data.status} ${data.error_message ?? ""}`);
      return null;
    }

    const { lat, lng } = data.results[0].geometry.location;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    const formattedAddress = data.results[0].formatted_address as string | undefined;
    return { lat, lng, formattedAddress };
  } catch {
    return null;
  }
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

  try {
    const url = `${GOOGLE_GEOCODE_BASE}?latlng=${lat},${lng}&result_type=locality|sublocality&language=en&key=${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) return null;

    const components = data.results[0].address_components as Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;

    const locality = components.find(
      (c) => c.types.includes("locality") || c.types.includes("sublocality"),
    );
    const state = components.find((c) =>
      c.types.includes("administrative_area_level_1"),
    );

    if (!locality) return null;
    // #968: Google returns admin_area_level_1.short_name = "D" for County
    // Dublin (an Eircode prefix, not a real abbreviation), which produced
    // "Dublin, D". Drop the suffix only for IE so we don't accidentally
    // strip a legitimate 1-char admin code elsewhere (e.g., AR ISO 3166-2).
    const stateShort = state?.short_name;
    const countryShort = components.find((c) => c.types.includes("country"))?.short_name;
    if (countryShort === "IE" && stateShort && stateShort.length < 2) {
      return locality.long_name;
    }
    return stateShort
      ? `${locality.long_name}, ${stateShort}`
      : locality.long_name;
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
