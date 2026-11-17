/** Pure helpers for the Half-Mind rows of the admin discovery queue. */

import { haversineDistance } from "@/lib/geo";

export type HalfMindRowAction = "link" | "add" | "dismiss" | "unlink" | "view-kennel";

/** Which actions a Half-Mind row offers, by its review status. */
export function halfMindRowActions(status: string): HalfMindRowAction[] {
  switch (status) {
    case "NEW":
      return ["link", "add", "dismiss"];
    case "LINKED":
      return ["unlink"];
    case "ADDED":
      return ["view-kennel"];
    default:
      return [];
  }
}

export const HALF_MIND_DEAD_BADGE = "Half-Mind marks this kennel dead";
export const HALF_MIND_MISSING_BADGE = "No longer on Half-Mind";

/** Red-badge text for a LINKED/ADDED row whose listing says dead or is gone; null otherwise. */
export function halfMindStatusBadge(status: string, externalStatus: string | null): string | null {
  if (status !== "LINKED" && status !== "ADDED") return null;
  if (externalStatus === "dead") return HALF_MIND_DEAD_BADGE;
  if (externalStatus === "missing") return HALF_MIND_MISSING_BADGE;
  return null;
}

/** The admin kennels page filtered to one kennel (it opens the status dialog from the row menu). */
export function adminKennelStatusHref(shortName: string): string {
  return `/admin/kennels?q=${encodeURIComponent(shortName)}`;
}

type RegionWithCentroid = { id: string; centroidLat: number | null; centroidLng: number | null };

/** The region whose centroid is nearest the listing's coordinates, or null without coordinates/centroids. */
export function nearestRegionId(
  latitude: number | null,
  longitude: number | null,
  regions: readonly RegionWithCentroid[],
): string | null {
  if (latitude == null || longitude == null) return null;
  let bestId: string | null = null;
  let bestKm = Infinity;
  for (const r of regions) {
    if (r.centroidLat == null || r.centroidLng == null) continue;
    const km = haversineDistance(latitude, longitude, r.centroidLat, r.centroidLng);
    if (km < bestKm) {
      bestKm = km;
      bestId = r.id;
    }
  }
  return bestId;
}

type PickerKennel = { id: string; shortName: string; fullName: string; region: string };

/** Client-side name search for the Link picker; empty query returns nothing, capped at `limit`. */
export function searchKennels<T extends PickerKennel>(kennels: readonly T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: T[] = [];
  for (const k of kennels) {
    if (k.shortName.toLowerCase().includes(q) || k.fullName.toLowerCase().includes(q)) {
      out.push(k);
      if (out.length >= limit) break;
    }
  }
  return out;
}
