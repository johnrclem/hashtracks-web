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
      const lat = parseFloat(atMatch[1]);
      const lng = parseFloat(atMatch[2]);
      if (isValidCoords(lat, lng)) return { lat, lng };
    }

    const parsedUrl = new URL(url);

    // Pattern 2: ?q=lat,lng (query with raw numeric coords — not a place name)
    // e.g. https://maps.google.com/?q=40.748,-73.985
    const q = parsedUrl.searchParams.get("q");
    if (q) {
      const qMatch = q.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
      if (qMatch) {
        const lat = parseFloat(qMatch[1]);
        const lng = parseFloat(qMatch[2]);
        if (isValidCoords(lat, lng)) return { lat, lng };
      }
    }

    // Pattern 3: ll=lat,lng (legacy format)
    // e.g. https://maps.google.com/maps?ll=40.748,-73.985
    const ll = parsedUrl.searchParams.get("ll");
    if (ll) {
      const llMatch = ll.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
      if (llMatch) {
        const lat = parseFloat(llMatch[1]);
        const lng = parseFloat(llMatch[2]);
        if (isValidCoords(lat, lng)) return { lat, lng };
      }
    }

    // Pattern 4: query=lat,lng (used by several adapters for precise coords)
    // e.g. https://www.google.com/maps/search/?api=1&query=40.748,-73.985
    const query = parsedUrl.searchParams.get("query");
    if (query) {
      const queryMatch = query.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
      if (queryMatch) {
        const lat = parseFloat(queryMatch[1]);
        const lng = parseFloat(queryMatch[2]);
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
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Region center coordinates for approximate pin fallback (all 21 regions from REGION_CONFIG). */
export const REGION_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  // US East Coast
  "New York City, NY": { lat: 40.71, lng: -74.01 },
  "Long Island, NY": { lat: 40.79, lng: -73.13 },
  "Boston, MA": { lat: 42.36, lng: -71.06 },
  "North NJ": { lat: 40.78, lng: -74.11 },
  "New Jersey": { lat: 40.06, lng: -74.41 },
  "Philadelphia, PA": { lat: 39.95, lng: -75.17 },
  // US Midwest
  "Chicago, IL": { lat: 41.88, lng: -87.63 },
  "South Shore, IN": { lat: 41.60, lng: -87.34 },
  // US DC / DMV
  "Washington, DC": { lat: 38.91, lng: -77.04 },
  "Northern Virginia": { lat: 38.85, lng: -77.20 },
  "Baltimore, MD": { lat: 39.29, lng: -76.61 },
  "Frederick, MD": { lat: 39.41, lng: -77.41 },
  "Fredericksburg, VA": { lat: 38.30, lng: -77.46 },
  "Southern Maryland": { lat: 38.55, lng: -76.80 },
  "Jefferson County, WV": { lat: 39.32, lng: -77.87 },
  // US West Coast
  "San Francisco, CA": { lat: 37.77, lng: -122.42 },
  "Oakland, CA": { lat: 37.80, lng: -122.27 },
  "San Jose, CA": { lat: 37.34, lng: -121.89 },
  "Marin County, CA": { lat: 37.97, lng: -122.53 },
  // UK
  "London": { lat: 51.51, lng: -0.13 },
  "London, England": { lat: 51.51, lng: -0.13 },
  "London, UK": { lat: 51.51, lng: -0.13 },
  "South West London": { lat: 51.46, lng: -0.20 },
  "Surrey": { lat: 51.31, lng: -0.31 },
  "Surrey, UK": { lat: 51.31, lng: -0.31 },
  "Old Coulsdon": { lat: 51.32, lng: -0.10 },
  "Enfield": { lat: 51.65, lng: -0.08 },
  "Barnes": { lat: 51.47, lng: -0.25 },
  "West London": { lat: 51.51, lng: -0.27 },
};

/**
 * Region hex pin colors derived from the region badge palette (600-shade for map visibility).
 * Matches the bg color family in REGION_CONFIG classes in src/lib/format.ts.
 */
export const REGION_COLORS: Record<string, string> = {
  "New York City, NY": "#2563eb",    // blue-600
  "Long Island, NY": "#0891b2",      // cyan-600
  "Boston, MA": "#dc2626",           // red-600
  "North NJ": "#059669",             // emerald-600
  "New Jersey": "#16a34a",           // green-600
  "Philadelphia, PA": "#d97706",     // amber-600
  "Chicago, IL": "#9333ea",          // purple-600
  "South Shore, IN": "#7c3aed",      // violet-600
  "Washington, DC": "#475569",       // slate-600
  "Northern Virginia": "#57534e",    // stone-600
  "Baltimore, MD": "#ea580c",        // orange-600
  "Frederick, MD": "#f97316",        // orange-500
  "Fredericksburg, VA": "#78716c",   // stone-500
  "Southern Maryland": "#f97316",    // orange-500
  "Jefferson County, WV": "#65a30d", // lime-600
  "San Francisco, CA": "#0d9488",    // teal-600
  "Oakland, CA": "#14b8a6",          // teal-500
  "San Jose, CA": "#0284c7",         // sky-600
  "Marin County, CA": "#14b8a6",     // teal-500
  "London": "#e11d48",               // rose-600
  "London, England": "#e11d48",      // rose-600
  "London, UK": "#e11d48",           // rose-600
  "South West London": "#e11d48",    // rose-600
  "Surrey": "#db2777",               // pink-600
  "Surrey, UK": "#db2777",           // pink-600
  "Old Coulsdon": "#ec4899",         // pink-500
  "Enfield": "#ec4899",              // pink-500
  "Barnes": "#db2777",               // pink-600
  "West London": "#f43f5e",          // rose-500
};

/** Default color for unknown regions. */
export const DEFAULT_PIN_COLOR = "#6b7280"; // gray-500

/** Get region pin color, falling back to gray for unknown regions. */
export function getRegionColor(region: string): string {
  return REGION_COLORS[region] ?? DEFAULT_PIN_COLOR;
}

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
  const centroid = REGION_CENTROIDS[region];
  if (centroid) {
    return { lat: centroid.lat, lng: centroid.lng, precise: false };
  }
  return null;
}
