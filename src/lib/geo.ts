/**
 * Geographic utilities: coordinate extraction from Maps URLs, region centroids,
 * and region pin colors for map rendering.
 */

/** Extract lat/lng from a Google Maps URL. Returns null if not parseable. */
export function extractCoordsFromMapsUrl(url: string): { lat: number; lng: number } | null {
  if (!url) return null;

  try {
    // Pattern 1: @lat,lng,zoom path segment (most common Google Maps share link)
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
): Promise<{ lat: number; lng: number; formattedAddress?: string } | null> {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey || !address.trim()) return null;

  try {
    const url = `${GOOGLE_GEOCODE_BASE}?address=${encodeURIComponent(address)}&language=en&key=${apiKey}`;
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
    return state
      ? `${locality.long_name}, ${state.short_name}`
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
