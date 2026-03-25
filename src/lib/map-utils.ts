/**
 * Shared map utilities for coordinate grouping, key parsing, and cluster rendering.
 * Used by both Hareline MapView and Kennel MapView to handle co-located pins.
 */

import type { Cluster, Marker, Renderer, ClusterStats } from "@googlemaps/markerclusterer";

// ── Coordinate grouping ─────────────────────────────────────────────────────

/** Rounding precision: 4 decimal places ~11m tolerance. */
const PRECISION = 4;

function roundCoord(n: number): number {
  const factor = 10 ** PRECISION;
  return Math.round(n * factor) / factor;
}

/**
 * Build a coordinate key string from lat/lng by rounding to 4 decimal places.
 * Inverse of `parseCoordKey`. Used by `groupByCoordinates` and for coordinate
 * equality checks in cluster click handlers.
 */
export function toCoordKey(lat: number, lng: number): string {
  return `${roundCoord(lat)},${roundCoord(lng)}`;
}

/**
 * Group items by their rounded coordinates.
 *
 * Items returning null from `getCoords` are excluded.
 * Coordinates are rounded to 4 decimal places (~11m tolerance) so that
 * nearby pins collapse into the same bucket.
 *
 * @returns Map keyed by `"lat,lng"` (e.g. `"40.7488,-73.9856"`) → array of items at that location.
 */
export function groupByCoordinates<T>(
  items: T[],
  getCoords: (t: T) => { lat: number; lng: number } | null,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const coords = getCoords(item);
    if (!coords) continue;

    const key = toCoordKey(coords.lat, coords.lng);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

/**
 * Extract lat/lng from a coordinate key string.
 * Inverse of the key format produced by `groupByCoordinates`.
 *
 * @param key — Format `"lat,lng"` (e.g. `"40.7488,-73.9856"`)
 */
export function parseCoordKey(key: string): { lat: number; lng: number } {
  const [latStr, lngStr] = key.split(",");
  return {
    lat: Number.parseFloat(latStr),
    lng: Number.parseFloat(lngStr),
  };
}

// ── Cluster renderer ─────────────────────────────────────────────────────────

/** Size tiers for cluster circles. */
function getClusterSize(count: number): number {
  if (count >= 50) return 52;
  if (count >= 10) return 44;
  return 36;
}

/**
 * Custom cluster renderer for HashTracks maps.
 *
 * Renders AdvancedMarkerElement clusters as slate-800 circles with
 * white JetBrains Mono count text. Three size tiers: <10 (36px),
 * 10-50 (44px), 50+ (52px).
 *
 * This class uses browser APIs (google.maps.marker.AdvancedMarkerElement,
 * document.createElement) and can only be used in client-side code.
 */
export class HashTracksClusterRenderer implements Renderer {
  render(
    { count, position }: Cluster,
    _stats: ClusterStats,
    map: google.maps.Map,
  ): Marker {
    const size = getClusterSize(count);

    // Build DOM element for the cluster pin
    const el = document.createElement("div");
    Object.assign(el.style, {
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: "#1e293b", // slate-800
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#ffffff",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: size <= 36 ? "13px" : size <= 44 ? "14px" : "16px",
      fontWeight: "600",
      boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
      cursor: "pointer",
      transition: "transform 0.15s ease",
    });
    el.textContent = String(count);

    return new google.maps.marker.AdvancedMarkerElement({
      position,
      content: el,
      map,
      zIndex: 1000 + count,
    });
  }
}
