"use server";

/**
 * Travel Mode server actions.
 *
 * - saveTravelSearch: persist a search (auth required, idempotent on coord identity)
 * - updateTravelSearch: mutate an existing saved search in-place
 * - deleteTravelSearch: soft-delete / archive (auth + ownership)
 * - listSavedSearches: user's active searches
 * - viewTravelSearch: update lastViewedAt + return search
 * - getDestinationKennelCount: lightweight kennel count for radius selector preview
 * - resolveDestinationTimezone: Google Time Zone API lookup
 */

import { Prisma, TravelSearchStatus } from "@/generated/prisma/client";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { haversineDistance, geocodeAddress } from "@/lib/geo";
import { parseUtcNoonDate } from "@/lib/date";
import type { ActionResult } from "@/lib/actions";
import {
  MAX_RADIUS_KM,
  MAX_STOPS_PER_TRIP,
  computeItinerarySignature,
} from "@/lib/travel/limits";
import { formatDateCompact } from "@/lib/travel/format";

// Don't re-export MAX_RADIUS_KM here — Next.js's `"use server"` boundary
// rejects any non-async export ("A 'use server' file can only export
// async functions, found number"). Callers (page.tsx, search.ts) import
// it from `@/lib/travel/limits` directly.

/**
 * Maximum number of saved trips returned by listSavedSearches. Keeps the
 * /travel/saved dashboard's per-trip weather fan-out from spiking under
 * a malicious account creating many trips. Also a sensible UX cap — at
 * the practical user limit any individual trip is hard to find anyway.
 */
const MAX_SAVED_TRIPS = 50;

// ============================================================================
// Types
// ============================================================================

/**
 * Per-stop save payload. A trip is 1..MAX_STOPS_PER_TRIP of these.
 * Callers using the legacy flat shape (label + latitude + ...) are
 * normalized into a single-element array internally.
 */
export interface SaveDestinationParams {
  label: string;
  placeId?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  radiusKm: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

/**
 * saveTravelSearch accepts either a flat single-destination shape (for
 * backward-compat with existing callers — TravelAutoSave, TripSummary)
 * or an explicit `destinations` array for multi-stop trips. Internally
 * both paths normalize to `SaveDestinationParams[]`.
 */
export type SaveTravelSearchParams =
  | SaveDestinationParams
  | { destinations: SaveDestinationParams[] };

interface FindExistingSearchParams {
  latitude: number;
  longitude: number;
  /**
   * Optional Google Places ID. When present, the lookup tries both
   * placeId-first and coord-fallback signatures so a trip saved via
   * autocomplete (placeId recorded) still matches a URL-derived lookup
   * that only carries lat/lng.
   */
  placeId?: string;
  /**
   * Accept a single radius or a list to match across. Callers pass an
   * array to tolerate legacy saved-trip rows whose persisted radius is
   * outside the closed tier enum {10,25,50,100} — e.g. an older build
   * or an admin-side save where the current URL has been snapped to a
   * different tier by server + client sync.
   */
  radiusKm: number | number[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

// ============================================================================
// findExistingSavedSearch
// ============================================================================

/**
 * Look up an existing saved search for the current user that matches the
 * given coords + radius + date window. Used by /travel page SSR to flip
 * the Save Trip button to a Saved state when a user revisits a trip they
 * already saved. Identity is coords-based (not label) so "San Diego, CA"
 * vs "San Diego, California" with the same coords still matches.
 *
 * Returns the TravelSearch id or null. Never throws; returns null on any
 * failure (auth, db, etc.) so the page renders the unsaved state as a
 * safe fallback — the Save button still works.
 */
/**
 * Normalize the legacy flat-shape saveTravelSearch payload into the
 * array form used internally. Callers using `{ destinations: [...] }`
 * pass through; callers using `{ label, latitude, ... }` get wrapped in
 * a single-element array.
 */
function normalizeDestinations(params: SaveTravelSearchParams): SaveDestinationParams[] {
  if ("destinations" in params) return params.destinations;
  return [params];
}

/**
 * findExistingSavedSearch builds candidate signatures (coord-based always,
 * plus placeId-based when available) and matches either. A trip saved via
 * autocomplete (placeId present) should still match when looked up via URL
 * params that lack the placeId.
 *
 * Accepts an array of radii so legacy rows persisting a radius outside the
 * closed tier enum {10,25,50,100} still resolve.
 */
export async function findExistingSavedSearch(
  params: FindExistingSearchParams,
): Promise<string | null> {
  try {
    const user = await getOrCreateUser();
    if (!user) return null;
    const { startDate, endDate, placeId, latitude, longitude } = params;
    const radii = Array.isArray(params.radiusKm)
      ? Array.from(new Set(params.radiusKm))
      : [params.radiusKm];

    const buildSig = (radiusKm: number, withPlaceId: boolean) =>
      computeItinerarySignature([
        {
          ...(withPlaceId && placeId ? { placeId } : {}),
          latitude,
          longitude,
          radiusKm,
          startDate,
          endDate,
        },
      ]);

    const signatures: string[] = [];
    for (const radiusKm of radii) {
      signatures.push(buildSig(radiusKm, false));
      if (placeId) signatures.push(buildSig(radiusKm, true));
    }

    const match = await prisma.travelSearch.findFirst({
      where: {
        userId: user.id,
        status: TravelSearchStatus.ACTIVE,
        itinerarySignature: { in: Array.from(new Set(signatures)) },
      },
      select: { id: true },
    });
    return match?.id ?? null;
  } catch (err) {
    console.error("[travel] findExistingSavedSearch failed", err);
    return null;
  }
}

// ============================================================================
// saveTravelSearch
// ============================================================================

export async function saveTravelSearch(
  params: SaveTravelSearchParams,
): Promise<ActionResult<{ id: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const stops = normalizeDestinations(params);
  const validation = validateSearchParams(stops);
  if (validation) return { error: validation };

  const signature = computeItinerarySignature(stops);
  const name = formatItineraryName(stops);
  const matchWhere = {
    userId: user.id,
    status: TravelSearchStatus.ACTIVE,
    itinerarySignature: signature,
  } as const;

  // Dedup has two layers of defense:
  //   1. In-transaction findFirst by (userId, itinerarySignature) —
  //      TravelAutoSave fires on every post-sign-in mount and double-
  //      click is a real (if rare) UX, so the common "trip already
  //      saved" path returns its id without writing.
  //   2. DB partial-unique on TravelSearch (userId, itinerarySignature)
  //      WHERE status='ACTIVE'. Catches the race between the findFirst
  //      and the create. P2002 → refetch the winner → return its id.
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.travelSearch.findFirst({
        where: matchWhere,
        select: { id: true },
      });
      if (existing) return { success: true as const, id: existing.id };

      const search = await tx.travelSearch.create({
        data: {
          userId: user.id,
          name,
          status: TravelSearchStatus.ACTIVE,
          itinerarySignature: signature,
        },
      });
      // Compound FK requires explicit userId on the child insert — Prisma's
      // nested-create would omit it. createMany for the 1..3 destinations.
      await tx.travelDestination.createMany({
        data: stops.map((stop, i) => buildDestinationData(search.id, user.id, stop, i)),
      });
      return { success: true as const, id: search.id };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.travelSearch.findFirst({
        where: matchWhere,
        select: { id: true },
      });
      if (winner) return { success: true, id: winner.id };
      return { error: "Could not save trip — please try again" };
    }
    throw err;
  }
}

// ============================================================================
// updateTravelSearch
// ============================================================================

/**
 * Mutate an existing saved search in-place. Used by TripSummary's
 * "Update with current params" dropdown when a user tweaks dates/radius/
 * destination label for an already-saved trip and wants to keep the same
 * TravelSearch id (so dashboard ordering and `lastViewedAt` are stable).
 *
 * Replaces the destination row in a transaction. The compound FK on
 * TravelDestination requires explicit child writes (not nested-create)
 * since Prisma's nested-create input excludes the userId column.
 *
 * If the new params would collide with another active trip the same user
 * already saved (the partial-unique index), returns a clear error rather
 * than throwing P2002 to the user as a 500.
 */
export async function updateTravelSearch(
  id: string,
  params: SaveTravelSearchParams,
): Promise<ActionResult<{ id: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const stops = normalizeDestinations(params);
  const validation = validateSearchParams(stops);
  if (validation) return { error: validation };

  const search = await prisma.travelSearch.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!search) return { error: "Search not found" };
  if (search.userId !== user.id) return { error: "Not authorized" };

  const signature = computeItinerarySignature(stops);
  const name = formatItineraryName(stops);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.travelDestination.deleteMany({
        where: { travelSearchId: id, userId: user.id },
      });
      await tx.travelSearch.update({
        where: { id },
        data: {
          name,
          status: TravelSearchStatus.ACTIVE,
          itinerarySignature: signature,
        },
      });
      await tx.travelDestination.createMany({
        data: stops.map((stop, i) => buildDestinationData(id, user.id, stop, i)),
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "Another saved trip already has these dates and location" };
    }
    throw err;
  }

  return { success: true, id };
}

// ============================================================================
// deleteTravelSearch
// ============================================================================

/**
 * Archive a saved trip. Two coordinated writes in one transaction:
 *   1. Set TravelSearch.status = ARCHIVED (preserves the parent row for
 *      lastViewedAt / createdAt history).
 *   2. Set TravelDestination.status = ARCHIVED so the partial-unique
 *      index (WHERE status='ACTIVE') stops counting this row, freeing
 *      the dedup slot for re-saving the same trip.
 *
 * Note: the partial unique now does the heavy lifting — even if a future
 * code path leaves an ARCHIVED parent with an ACTIVE destination, dedup
 * still recovers because the constraint is gated on the destination's
 * own status. Earlier behavior deleted the destination row outright;
 * setting status preserves history (label, placeId, timezone) without
 * cluttering the dashboard since /travel/saved filters on parent status.
 */
export async function deleteTravelSearch(
  id: string,
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const search = await prisma.travelSearch.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!search) return { error: "Search not found" };
  if (search.userId !== user.id) return { error: "Not authorized" };

  await prisma.$transaction([
    prisma.travelDestination.updateMany({
      where: { travelSearchId: id },
      data: { status: TravelSearchStatus.ARCHIVED },
    }),
    prisma.travelSearch.update({ where: { id }, data: { status: TravelSearchStatus.ARCHIVED } }),
  ]);

  return { success: true };
}

/**
 * Un-archive a previously soft-deleted trip. Exists so the results-page
 * Undo affordance can restore the same row the user just removed —
 * preserving id, createdAt, lastViewedAt, and the trip's persisted radius
 * (which may differ from the snapped radius if the row was saved via an
 * earlier build or an admin path).
 *
 * Fails closed if an ACTIVE trip would collide with the partial-unique
 * index (same lat/lng/radius/dates) — that situation means the user saved
 * a duplicate between the delete and the undo; refuse to clobber it.
 */
export async function restoreTravelSearch(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const search = await prisma.travelSearch.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });
  if (!search) return { error: "Search not found" };
  if (search.userId !== user.id) return { error: "Not authorized" };
  if (search.status === TravelSearchStatus.ACTIVE) return { success: true, id };

  try {
    await prisma.$transaction([
      prisma.travelDestination.updateMany({
        where: { travelSearchId: id },
        data: { status: TravelSearchStatus.ACTIVE },
      }),
      prisma.travelSearch.update({
        where: { id },
        data: { status: TravelSearchStatus.ACTIVE },
      }),
    ]);
    return { success: true, id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "A duplicate trip was saved in the meantime." };
    }
    throw err;
  }
}

// ============================================================================
// listSavedSearches
// ============================================================================

export interface SavedSearchSummaryDestination {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
  radiusKm: number;
  startDate: Date;
  endDate: Date;
}

export interface SavedSearchSummary {
  id: string;
  name: string | null;
  status: TravelSearchStatus;
  lastViewedAt: Date | null;
  createdAt: Date;
  /** All legs of the trip, ordered by position (0..N-1). */
  destinations: SavedSearchSummaryDestination[];
  /** Legacy alias — first leg. */
  destination: SavedSearchSummaryDestination | null;
}

export async function listSavedSearches(): Promise<
  ActionResult<{ searches: SavedSearchSummary[] }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const searches = await prisma.travelSearch.findMany({
    where: {
      userId: user.id,
      status: TravelSearchStatus.ACTIVE,
    },
    include: {
      destinations: {
        // Defense against parent/child status drift: only surface ACTIVE
        // child rows even when the parent is ACTIVE. Without this, a
        // destination that got stuck ARCHIVED while its parent stayed
        // ACTIVE would render as a destinationless dashboard card.
        where: { status: TravelSearchStatus.ACTIVE },
        orderBy: { position: "asc" },
        select: {
          label: true,
          latitude: true,
          longitude: true,
          timezone: true,
          radiusKm: true,
          startDate: true,
          endDate: true,
        },
      },
    },
    orderBy: [
      { lastViewedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: MAX_SAVED_TRIPS,
  });

  return {
    success: true,
    searches: searches.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      lastViewedAt: s.lastViewedAt,
      createdAt: s.createdAt,
      destinations: s.destinations,
      destination: s.destinations[0] ?? null,
    })),
  };
}

// ============================================================================
// viewTravelSearch
// ============================================================================

export interface SavedSearchDetailDestination {
  label: string;
  placeId: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
  radiusKm: number;
  startDate: Date;
  endDate: Date;
}

export interface SavedSearchDetail {
  id: string;
  name: string | null;
  destinations: SavedSearchDetailDestination[];
  /** Legacy alias — first leg. */
  destination: SavedSearchDetailDestination | null;
}

export async function viewTravelSearch(
  id: string,
): Promise<ActionResult<SavedSearchDetail>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const search = await prisma.travelSearch.findUnique({
    where: { id },
    include: {
      destinations: {
        // Only return ACTIVE child rows. Archived parents intentionally
        // come back destinationless (the existing `?? null` branch
        // handles that gracefully); this also defends against parent/
        // child status drift.
        where: { status: TravelSearchStatus.ACTIVE },
        orderBy: { position: "asc" },
        select: {
          label: true,
          placeId: true,
          latitude: true,
          longitude: true,
          timezone: true,
          radiusKm: true,
          startDate: true,
          endDate: true,
        },
      },
    },
  });
  if (!search) return { error: "Search not found" };
  if (search.userId !== user.id) return { error: "Not authorized" };

  await prisma.travelSearch.update({
    where: { id },
    data: { lastViewedAt: new Date() },
  });

  return {
    success: true,
    id: search.id,
    name: search.name,
    destinations: search.destinations,
    destination: search.destinations[0] ?? null,
  };
}

// ============================================================================
// getDestinationKennelCount
// ============================================================================

// In-memory cache for kennel count preview. Coordinates are rounded to
// 1 decimal (~11km precision) and radius clamped to allowed values so
// the cache key space is bounded. On Vercel serverless this is ephemeral
// (warm-instance lifetime) but still prevents repeated DB scans during
// a single form interaction session.
const kennelCountCache = new Map<string, { count: number; expiresAt: number }>();
const KENNEL_COUNT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Lightweight kennel count for the radius selector preview.
 * No auth required — called during form interaction for both guests
 * and authenticated users.
 *
 * Hardened against abuse: coordinates rounded to 1 decimal (~11km),
 * radius clamped to 250km max, results cached in-memory for 5 min.
 */
export async function getDestinationKennelCount(
  latitude: number,
  longitude: number,
  radiusKm: number,
): Promise<{ count: number }> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusKm)) {
    return { count: 0 };
  }

  // Normalize inputs to bound the cache key space and prevent abuse
  const roundedLat = Math.round(latitude * 10) / 10;
  const roundedLng = Math.round(longitude * 10) / 10;
  const clampedRadius = Math.min(Math.max(radiusKm, 1), MAX_RADIUS_KM);

  const cacheKey = `${roundedLat},${roundedLng},${clampedRadius}`;
  const cached = kennelCountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { count: cached.count };
  }

  const kennels = await prisma.kennel.findMany({
    where: { isHidden: false },
    select: {
      latitude: true,
      longitude: true,
      regionRef: { select: { centroidLat: true, centroidLng: true } },
    },
  });

  let count = 0;
  for (const k of kennels) {
    const kLat = k.latitude ?? k.regionRef?.centroidLat;
    const kLng = k.longitude ?? k.regionRef?.centroidLng;
    if (kLat == null || kLng == null) continue;
    if (haversineDistance(roundedLat, roundedLng, kLat, kLng) <= clampedRadius) {
      count++;
    }
  }

  kennelCountCache.set(cacheKey, { count, expiresAt: Date.now() + KENNEL_COUNT_CACHE_TTL_MS });
  return { count };
}

// ============================================================================
// resolveDestinationTimezone
// ============================================================================

// In-memory cache for timezone lookups. On Vercel serverless, this only
// persists within a warm lambda instance (typically 5-15 min), not the full
// 24-hour TTL. That's acceptable — it deduplicates within a warm period
// and the Google Time Zone API is free-tier at our volume.
const timezoneCache = new Map<string, { timezone: string; expiresAt: number }>();
const TZ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the IANA timezone for a destination via the Google Time Zone API.
 * Results are cached in memory keyed by lat/lng rounded to 1 decimal place
 * (~11km precision). Timezone boundaries are typically 100km+ wide, so 11km
 * precision is more than sufficient and dramatically bounds the cache key
 * space against abuse (only ~64K possible keys vs 64M at 3 decimals).
 *
 * No auth required — called during form interaction.
 */
export async function resolveDestinationTimezone(
  latitude: number,
  longitude: number,
): Promise<ActionResult<{ timezone: string }>> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { error: "Invalid coordinates" };
  }

  // Round to 1 decimal (~11km) — sufficient for timezone resolution,
  // bounds cache key space to ~64K entries max (vs 64M at 3 decimals)
  const roundedLat = Math.round(latitude * 10) / 10;
  const roundedLng = Math.round(longitude * 10) / 10;
  const cacheKey = `${roundedLat},${roundedLng}`;
  const cached = timezoneCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { success: true, timezone: cached.timezone };
  }

  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!apiKey) {
    return { error: "Time Zone API not configured" };
  }

  try {
    // Use full-precision coordinates for the API call to get an accurate result.
    // Only the cache key is rounded — the API sees the real destination.
    const timestamp = Math.floor(Date.now() / 1000);
    const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${latitude},${longitude}&timestamp=${timestamp}&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { error: "Time Zone API request failed" };
    }

    const data = (await res.json()) as { status: string; timeZoneId?: string };
    if (data.status !== "OK" || !data.timeZoneId) {
      return { error: `Time Zone API error: ${data.status}` };
    }

    timezoneCache.set(cacheKey, {
      timezone: data.timeZoneId,
      expiresAt: Date.now() + TZ_CACHE_TTL_MS,
    });

    return { success: true, timezone: data.timeZoneId };
  } catch {
    return { error: "Time Zone API timeout or network error" };
  }
}

// ============================================================================
// geocodeDestination
// ============================================================================

// In-memory geocode cache — same pattern as kennel count and timezone caches.
// Normalized query key prevents abuse from slight variations.
const geocodeCache = new Map<string, { result: { label: string; latitude: number; longitude: number }; expiresAt: number }>();
const GEOCODE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Server-side geocoding fallback for destination input. Uses the Google
 * Geocoding API (already enabled) when the client-side Places Autocomplete
 * isn't available (e.g., Places API (New) not enabled in GCP project).
 *
 * Cached in memory for 1 hour keyed by normalized query. On Vercel
 * serverless this is ephemeral (warm-instance lifetime).
 *
 * No auth required — called during form interaction.
 */
export async function geocodeDestination(
  query: string,
): Promise<ActionResult<{ label: string; latitude: number; longitude: number }>> {
  if (!query.trim()) return { error: "Empty query" };

  const cacheKey = query.trim().toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { success: true, ...cached.result };
  }

  const result = await geocodeAddress(query);
  if (!result) return { error: "Could not find that location" };

  const geo = {
    label: result.formattedAddress ?? query,
    latitude: result.lat,
    longitude: result.lng,
  };
  geocodeCache.set(cacheKey, { result: geo, expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS });

  return { success: true, ...geo };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate the stops array. Accepts either a single-stop or a multi-stop
 * itinerary (1..MAX_STOPS_PER_TRIP). Each stop is validated individually;
 * additionally, consecutive stops must satisfy startDate(i) ≥ startDate(i-1)
 * (sequential ordering — shared boundary dates are allowed).
 */
function validateSearchParams(stops: SaveDestinationParams[]): string | null {
  if (stops.length < 1) return "At least one destination is required";
  if (stops.length > MAX_STOPS_PER_TRIP) {
    return `At most ${MAX_STOPS_PER_TRIP} stops per trip`;
  }

  for (const stop of stops) {
    const err = validateDestination(stop);
    if (err) return err;
  }

  for (let i = 1; i < stops.length; i++) {
    const prev = parseUtcNoonDate(stops[i - 1].startDate);
    const curr = parseUtcNoonDate(stops[i].startDate);
    if (curr < prev) {
      return `Leg ${i + 1} must start on or after leg ${i}`;
    }
  }

  return null;
}

function validateDestination(stop: SaveDestinationParams): string | null {
  if (!stop.label.trim()) return "Destination label is required";
  if (!Number.isFinite(stop.latitude) || stop.latitude < -90 || stop.latitude > 90) {
    return "Invalid latitude";
  }
  if (!Number.isFinite(stop.longitude) || stop.longitude < -180 || stop.longitude > 180) {
    return "Invalid longitude";
  }
  if (!Number.isFinite(stop.radiusKm) || stop.radiusKm <= 0) {
    return "Invalid radius";
  }
  // Mirror executeTravelSearch's clamp at the validation boundary so an
  // adversary can't persist a TravelSearch with a radius that's far
  // larger than the search would ever respect at runtime.
  if (stop.radiusKm > MAX_RADIUS_KM) {
    return `Radius too large (max ${MAX_RADIUS_KM} km)`;
  }
  // Prisma's Int column rejects fractions at write time — surfaces as a
  // 500 instead of a user-facing error message. Catch the shape here.
  if (!Number.isInteger(stop.radiusKm)) {
    return "Radius must be a whole number";
  }

  // Strict YYYY-MM-DD validation: parse components and round-trip to reject
  // impossible dates like 2026-02-31 (JS silently normalizes to March 3)
  if (!isValidDateString(stop.startDate)) return "Invalid start date";
  if (!isValidDateString(stop.endDate)) return "Invalid end date";

  const startDate = parseUtcNoonDate(stop.startDate);
  const endDate = parseUtcNoonDate(stop.endDate);
  if (endDate < startDate) return "End date must be on or after start date";

  return null;
}

/**
 * Shared shape for the TravelDestination create payload. Used by both
 * saveTravelSearch and updateTravelSearch — keeping the create data in
 * one place means a future field addition can't drift between the two
 * sites. `position` is explicit so the compound `@@unique([travelSearchId,
 * position])` constraint is satisfied.
 */
function buildDestinationData(
  travelSearchId: string,
  userId: string,
  stop: SaveDestinationParams,
  position: number,
) {
  return {
    travelSearchId,
    userId,
    position,
    status: TravelSearchStatus.ACTIVE,
    label: stop.label,
    placeId: stop.placeId ?? null,
    latitude: stop.latitude,
    longitude: stop.longitude,
    timezone: stop.timezone ?? null,
    radiusKm: stop.radiusKm,
    startDate: parseUtcNoonDate(stop.startDate),
    endDate: parseUtcNoonDate(stop.endDate),
  };
}

/**
 * Derive a trip name from the itinerary. Single-stop trips get the
 * existing "Label · Apr 14–21" shape. Multi-stop trips get "LabelA →
 * LabelB · Apr 14–21" spanning first-start to last-end.
 */
function formatItineraryName(stops: SaveDestinationParams[]): string {
  const labels = stops.map((s) => s.label).join(" → ");
  const startStr = stops[0].startDate;
  const endStr = stops.at(-1)!.endDate;
  const start = parseUtcNoonDate(startStr);
  const end = parseUtcNoonDate(endStr);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  const endFormatted = sameMonth
    ? end.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })
    : formatDateCompact(endStr);
  return `${labels} · ${formatDateCompact(startStr)}–${endFormatted}`;
}

/**
 * Validate a YYYY-MM-DD string strictly. JS Date normalizes impossible dates
 * (e.g., Feb 31 → Mar 3) instead of rejecting them. This round-trips the parsed
 * components back to a string and checks for equality.
 */
function isValidDateString(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const [, yStr, mStr, dStr] = match;
  const y = Number.parseInt(yStr, 10);
  const m = Number.parseInt(mStr, 10);
  const d = Number.parseInt(dStr, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
