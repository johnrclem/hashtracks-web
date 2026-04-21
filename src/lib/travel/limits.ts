/**
 * Domain caps shared between the validation boundary, the URL boundary,
 * and the search engine. Lives here (not in `actions.ts`) so non-action
 * modules can import it without crossing the `"use server"` boundary.
 */

import { createHash } from "node:crypto";

/** Hard cap on a saved or searched trip radius. */
export const MAX_RADIUS_KM = 250;

/** Max stops per itinerary (v1 cap). UI enforces; server re-enforces. */
export const MAX_STOPS_PER_TRIP = 3;

/**
 * Per-stop shape used by computeItinerarySignature. Matches the save
 * payload's subset that participates in trip identity.
 */
export interface SignatureStop {
  placeId?: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  startDate: string;
  endDate: string;
}

/**
 * Canonical JSON representation of one stop used in the itinerary signature.
 * Keys are emitted in a fixed insertion order so `JSON.stringify` produces
 * deterministic output. When placeId is set we omit coords — two provider
 * paths (autocomplete vs. server-side geocode) can emit coords that differ
 * by ~0.0001° for the same place, so the placeId-only form is the stable
 * identity.
 */
function canonicalStop(stop: SignatureStop, position: number) {
  if (stop.placeId) {
    return {
      position,
      placeId: stop.placeId,
      radiusKm: stop.radiusKm,
      startDate: stop.startDate,
      endDate: stop.endDate,
    };
  }
  return {
    position,
    placeId: null,
    latitude: stop.latitude,
    longitude: stop.longitude,
    radiusKm: stop.radiusKm,
    startDate: stop.startDate,
    endDate: stop.endDate,
  };
}

/**
 * SHA-256 hex digest of the ordered itinerary tuple. Trip-level dedup key;
 * partial-unique-indexed on (userId, itinerarySignature) WHERE status='ACTIVE'.
 * Same place in different positions or with different dates → different
 * signature → distinct trip.
 */
export function computeItinerarySignature(stops: SignatureStop[]): string {
  const canonical = JSON.stringify(stops.map((s, i) => canonicalStop(s, i)));
  return createHash("sha256").update(canonical).digest("hex");
}

/** Closed enum of radii exposed by the search pill selector. */
export const RADIUS_TIERS = [10, 25, 50, 100] as const;

/** Snap an arbitrary radius to the nearest supported tier. */
export function snapRadiusToTier(value: number): number {
  if ((RADIUS_TIERS as readonly number[]).includes(value)) return value;
  return RADIUS_TIERS.reduce((nearest, tier) =>
    Math.abs(tier - value) < Math.abs(nearest - value) ? tier : nearest,
  );
}
