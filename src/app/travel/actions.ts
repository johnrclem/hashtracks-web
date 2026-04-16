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
import { MAX_RADIUS_KM } from "@/lib/travel/limits";

// Re-export so existing callers (page.tsx) don't need to update their imports.
export { MAX_RADIUS_KM };

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

interface SaveTravelSearchParams {
  label: string;
  placeId?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  radiusKm: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

interface FindExistingSearchParams {
  latitude: number;
  longitude: number;
  radiusKm: number;
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
export async function findExistingSavedSearch(
  params: FindExistingSearchParams,
): Promise<string | null> {
  try {
    const user = await getOrCreateUser();
    if (!user) return null;
    const startDate = parseUtcNoonDate(params.startDate);
    const endDate = parseUtcNoonDate(params.endDate);
    const match = await prisma.travelSearch.findFirst({
      where: {
        userId: user.id,
        status: TravelSearchStatus.ACTIVE,
        destinations: {
          some: {
            latitude: params.latitude,
            longitude: params.longitude,
            radiusKm: params.radiusKm,
            startDate,
            endDate,
          },
        },
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

  // Validate inputs
  const validation = validateSearchParams(params);
  if (validation) return { error: validation };

  const startDate = parseUtcNoonDate(params.startDate);
  const endDate = parseUtcNoonDate(params.endDate);
  const name = formatTripName(params.label, startDate, endDate);

  // Atomic dedup via the DB partial-unique on TravelDestination
  // (userId, lat, lng, radius, dates) WHERE status='ACTIVE'. We attempt
  // the insert directly — on collision (concurrent caller, double-click,
  // refresh-after-save) P2002 fires, we refetch the winner, and return
  // its id so the race loser sees idempotent semantics. Two writes on
  // the happy path; happy path of an already-saved trip costs 1 read.
  //
  // Destination is a separate insert (not nested) because TravelDestination
  // uses a compound FK to TravelSearch(id, userId) for tenant isolation —
  // Prisma's nested-create input excludes the userId column.
  try {
    return await prisma.$transaction(async (tx) => {
      const search = await tx.travelSearch.create({
        data: { userId: user.id, name },
      });
      await tx.travelDestination.create({
        data: buildDestinationData(search.id, user.id, params, startDate, endDate),
      });
      return { success: true as const, id: search.id };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.travelSearch.findFirst({
        where: {
          userId: user.id,
          status: TravelSearchStatus.ACTIVE,
          destinations: {
            some: {
              latitude: params.latitude,
              longitude: params.longitude,
              radiusKm: params.radiusKm,
              startDate,
              endDate,
            },
          },
        },
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

  const validation = validateSearchParams(params);
  if (validation) return { error: validation };

  const search = await prisma.travelSearch.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!search) return { error: "Search not found" };
  if (search.userId !== user.id) return { error: "Not authorized" };

  const startDate = parseUtcNoonDate(params.startDate);
  const endDate = parseUtcNoonDate(params.endDate);
  const name = formatTripName(params.label, startDate, endDate);

  try {
    await prisma.$transaction(async (tx) => {
      // deleteMany on the destination and update on the parent are
      // independent (different rows, no FK dep). Run them in parallel
      // before the create — which must follow because the partial-unique
      // index would reject the new destination while the old one was
      // still ACTIVE.
      await Promise.all([
        tx.travelDestination.deleteMany({ where: { travelSearchId: id } }),
        tx.travelSearch.update({
          where: { id },
          data: { name, status: TravelSearchStatus.ACTIVE },
        }),
      ]);
      await tx.travelDestination.create({
        data: buildDestinationData(id, user.id, params, startDate, endDate),
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

// ============================================================================
// listSavedSearches
// ============================================================================

export interface SavedSearchSummary {
  id: string;
  name: string | null;
  status: TravelSearchStatus;
  lastViewedAt: Date | null;
  createdAt: Date;
  destination: {
    label: string;
    latitude: number;
    longitude: number;
    timezone: string | null;
    radiusKm: number;
    startDate: Date;
    endDate: Date;
  } | null;
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
      destination: s.destinations[0] ?? null,
    })),
  };
}

// ============================================================================
// viewTravelSearch
// ============================================================================

export interface SavedSearchDetail {
  id: string;
  name: string | null;
  destination: {
    label: string;
    placeId: string | null;
    latitude: number;
    longitude: number;
    timezone: string | null;
    radiusKm: number;
    startDate: Date;
    endDate: Date;
  } | null;
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

function validateSearchParams(params: SaveTravelSearchParams): string | null {
  if (!params.label.trim()) return "Destination label is required";
  if (!Number.isFinite(params.latitude) || params.latitude < -90 || params.latitude > 90) {
    return "Invalid latitude";
  }
  if (!Number.isFinite(params.longitude) || params.longitude < -180 || params.longitude > 180) {
    return "Invalid longitude";
  }
  if (!Number.isFinite(params.radiusKm) || params.radiusKm <= 0) {
    return "Invalid radius";
  }
  // Mirror executeTravelSearch's clamp at the validation boundary so an
  // adversary can't persist a TravelSearch with a radius that's far
  // larger than the search would ever respect at runtime.
  if (params.radiusKm > MAX_RADIUS_KM) {
    return `Radius too large (max ${MAX_RADIUS_KM} km)`;
  }
  // Prisma's Int column rejects fractions at write time — surfaces as a
  // 500 instead of a user-facing error message. Catch the shape here.
  if (!Number.isInteger(params.radiusKm)) {
    return "Radius must be a whole number";
  }

  // Validate date strings
  // Strict YYYY-MM-DD validation: parse components and round-trip to reject
  // impossible dates like 2026-02-31 (JS silently normalizes to March 3)
  const startValid = isValidDateString(params.startDate);
  if (!startValid) return "Invalid start date";
  const endValid = isValidDateString(params.endDate);
  if (!endValid) return "Invalid end date";

  const startDate = parseUtcNoonDate(params.startDate);
  const endDate = parseUtcNoonDate(params.endDate);
  if (endDate < startDate) return "End date must be on or after start date";

  return null;
}

/**
 * Shared shape for the TravelDestination create payload. Used by both
 * saveTravelSearch (new trip) and updateTravelSearch (replace destination
 * on edit) — keeping the create data in one place means a future field
 * addition can't drift between the two sites.
 */
function buildDestinationData(
  travelSearchId: string,
  userId: string,
  params: SaveTravelSearchParams,
  startDate: Date,
  endDate: Date,
) {
  return {
    travelSearchId,
    userId,
    status: TravelSearchStatus.ACTIVE,
    label: params.label,
    placeId: params.placeId ?? null,
    latitude: params.latitude,
    longitude: params.longitude,
    timezone: params.timezone ?? null,
    radiusKm: params.radiusKm,
    startDate,
    endDate,
  };
}

/** Format a trip name like "Atlanta, GA · Apr 14–21" */
function formatTripName(label: string, startDate: Date, endDate: Date): string {
  const startStr = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const sameMonth =
    startDate.getUTCMonth() === endDate.getUTCMonth() &&
    startDate.getUTCFullYear() === endDate.getUTCFullYear();

  const endStr = sameMonth
    ? endDate.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })
    : endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return `${label} · ${startStr}–${endStr}`;
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
