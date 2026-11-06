import { prisma } from "@/lib/db";
import {
  getValidAccessToken,
  fetchStravaActivities,
  parseStravaActivity,
} from "./client";
import { stravaActivityKey } from "./activity-key";
import { extractStravaActivityId } from "./url";
import { reverseGeocode, cityFromTimezone } from "@/lib/geo";

export interface SyncResult {
  created: number;
  updated: number;
  /** Cached rows removed because Strava no longer returns them (deleted, made private, or out of window). */
  removed: number;
  total: number;
  /** True when the sync was skipped because the cache is still fresh. */
  skipped?: boolean;
  error?: string;
}

const LOOKBACK_DAYS = 90;
/** A cache older than this is re-fetched on the next logbook visit. */
export const STALE_HOURS = 6;
/**
 * Cached rows not re-fetched within this window are purged by the daily
 * /api/cron/strava-cache-purge run. With a daily cron a row lives under 48h,
 * inside Strava API Policy §6.2 (7-day cache) and §6.3 (deletions within 48h).
 * Must stay well above STALE_HOURS so a fresh sync's rows are never purged.
 */
export const STRAVA_CACHE_TTL_HOURS = 24;

const EMPTY_RESULT = { created: 0, updated: 0, removed: 0, total: 0 } as const;

/**
 * Sync Strava activities for a user into the transient activity cache.
 *
 * - Lookback: 90 days from now
 * - Skips if lastSyncAt is within STALE_HOURS (unless forceRefresh)
 * - Upserts activities by stravaActivityId and stamps `fetchedAt`
 * - Deletes this user's cached rows that Strava no longer returns
 * - Rehydrates match state (matchedAttendanceId / matchDismissed) from the
 *   durable sources of truth: Attendance.stravaUrl and StravaDismissal
 * - Uses string extraction for dates (never new Date() on start_date_local)
 */
export async function syncStravaActivities(
  userId: string,
  options?: { forceRefresh?: boolean },
): Promise<SyncResult> {
  // Load connection
  const connection = await prisma.stravaConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    return { ...EMPTY_RESULT, error: "No Strava connection" };
  }

  // Check freshness (skip if synced recently)
  if (!options?.forceRefresh && connection.lastSyncAt) {
    const hoursSinceSync =
      (Date.now() - connection.lastSyncAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSync < STALE_HOURS) {
      return { ...EMPTY_RESULT, skipped: true };
    }
  }

  // Get valid access token (auto-refresh if needed)
  let accessToken: string;
  try {
    const tokenResult = await getValidAccessToken(connection);
    accessToken = tokenResult.accessToken;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token refresh failed";
    console.error(`[strava-sync] token refresh failed for connection ${connection.id}: ${message}`);
    return { ...EMPTY_RESULT, error: message };
  }

  // Calculate date range: 90 days ago → now (Unix seconds)
  const now = Math.floor(Date.now() / 1000);
  const after = now - LOOKBACK_DAYS * 24 * 60 * 60;

  // Fetch activities from Strava
  let rawActivities;
  try {
    rawActivities = await fetchStravaActivities(accessToken, after, now);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Activity fetch failed";
    console.error(`[strava-sync] activity fetch failed for connection ${connection.id}: ${message}`);
    return { ...EMPTY_RESULT, error: message };
  }

  // Parse all activities and batch by create vs update
  const parsed = rawActivities.map(parseStravaActivity);
  const stravaIds = parsed.map((p) => p.stravaActivityId);
  const fetchedAt = new Date();

  const { linkedAttendanceByActivityId, dismissedKeys } =
    await loadMatchState(userId, connection.id);
  const matchState = (stravaActivityId: string) => ({
    matchedAttendanceId: linkedAttendanceByActivityId.get(stravaActivityId) ?? null,
    matchDismissed: dismissedKeys.has(stravaActivityKey(stravaActivityId)),
  });

  // Single query to find all existing activities (include city for backfill optimization)
  const existingActivities = await prisma.stravaActivity.findMany({
    where: { stravaActivityId: { in: stravaIds } },
    select: { stravaActivityId: true, city: true, startLat: true, startLng: true },
  });
  const existingIdSet = new Set(existingActivities.map((a) => a.stravaActivityId));
  // Track activities that need city backfill (have coords but null city)
  const needsCityIds = new Set(
    existingActivities
      .filter((a) => a.city === null && (a.startLat != null || a.startLng != null))
      .map((a) => a.stravaActivityId),
  );

  const toCreate = parsed.filter((p) => !existingIdSet.has(p.stravaActivityId));
  const toUpdate = parsed.filter((p) => existingIdSet.has(p.stravaActivityId));

  // Drop cached rows Strava no longer returns: deleted or made private on
  // Strava, or aged out of the lookback window (API Policy §6.3).
  const { count: removed } = await prisma.stravaActivity.deleteMany({
    where: {
      stravaConnectionId: connection.id,
      stravaActivityId: { notIn: stravaIds },
    },
  });

  // Batch create new activities. skipDuplicates guards against two concurrent
  // syncs (e.g. two open tabs) racing on the stravaActivityId unique key.
  if (toCreate.length > 0) {
    await prisma.stravaActivity.createMany({
      data: toCreate.map((p) => ({
        stravaConnectionId: connection.id,
        stravaActivityId: p.stravaActivityId,
        name: p.name,
        sportType: p.sportType,
        dateLocal: p.dateLocal,
        timeLocal: p.timeLocal,
        distanceMeters: p.distanceMeters,
        movingTimeSecs: p.movingTimeSecs,
        startLat: p.startLat,
        startLng: p.startLng,
        timezone: p.timezone,
        fetchedAt,
        ...matchState(p.stravaActivityId),
      })),
      skipDuplicates: true,
    });
  }

  // Run geocoding and existing activity updates in parallel (disjoint data sets)
  await Promise.all([
    // Batch reverse-geocode new activities to populate city field
    toCreate.length > 0 ? backfillCities(toCreate) : Promise.resolve(),
    // Batch update existing activities in a single transaction
    toUpdate.length > 0
      ? prisma.$transaction(
          toUpdate.map((p) =>
            prisma.stravaActivity.update({
              where: { stravaActivityId: p.stravaActivityId },
              data: {
                name: p.name,
                sportType: p.sportType,
                dateLocal: p.dateLocal,
                timeLocal: p.timeLocal,
                distanceMeters: p.distanceMeters,
                movingTimeSecs: p.movingTimeSecs,
                startLat: p.startLat,
                startLng: p.startLng,
                timezone: p.timezone,
                fetchedAt,
                ...matchState(p.stravaActivityId),
              },
            }),
          ),
        )
      : Promise.resolve(),
  ]);

  // Backfill city for updated activities that had null city (tracked from initial query)
  if (needsCityIds.size > 0) {
    const toBackfill = toUpdate
      .filter((p) => needsCityIds.has(p.stravaActivityId))
      .filter((p) => p.startLat != null || p.startLng != null);
    if (toBackfill.length > 0) {
      await backfillCities(toBackfill);
    }
  }

  const created = toCreate.length;
  const updated = toUpdate.length;

  // Update lastSyncAt
  await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date() },
  });

  return { created, updated, removed, total: rawActivities.length };
}

/**
 * Load the durable match state for a user. Cache rows are transient, so the
 * user's decisions live elsewhere and are copied onto each freshly fetched row:
 * - links: Attendance.stravaUrl (activity ID → attendance ID)
 * - dismissals: StravaDismissal (hashed activity keys)
 */
async function loadMatchState(userId: string, stravaConnectionId: string) {
  const [linkedAttendances, dismissals] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId, stravaUrl: { not: null } },
      select: { id: true, stravaUrl: true },
    }),
    prisma.stravaDismissal.findMany({
      where: { stravaConnectionId },
      select: { activityKey: true },
    }),
  ]);

  const linkedAttendanceByActivityId = new Map<string, string>();
  for (const a of linkedAttendances) {
    const activityId = a.stravaUrl ? extractStravaActivityId(a.stravaUrl) : null;
    if (activityId && !linkedAttendanceByActivityId.has(activityId)) {
      linkedAttendanceByActivityId.set(activityId, a.id);
    }
  }

  return {
    linkedAttendanceByActivityId,
    dismissedKeys: new Set(dismissals.map((d) => d.activityKey)),
  };
}

/**
 * Delete cached activities that were not re-fetched within
 * STRAVA_CACHE_TTL_HOURS. Called daily by /api/cron/strava-cache-purge.
 * Only the transient cache is touched: links (Attendance.stravaUrl) and
 * dismissals (StravaDismissal) are the user's own durable records.
 */
export async function purgeExpiredStravaCache(
  now: Date = new Date(),
): Promise<{ deleted: number; olderThan: Date }> {
  const olderThan = new Date(now.getTime() - STRAVA_CACHE_TTL_HOURS * 60 * 60 * 1000);
  const { count } = await prisma.stravaActivity.deleteMany({
    where: { fetchedAt: { lt: olderThan } },
  });
  return { deleted: count, olderThan };
}

/** Round coords to 3 decimal places (~111m precision) for dedup key. */
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** Collect unique coordinates from activities, populating the coord→city map with placeholders. */
function collectUniqueCoords(
  activities: import("./types").ParsedStravaActivity[],
  coordToCity: Map<string, string | null>,
): Array<{ key: string; lat: number; lng: number }> {
  const uniqueCoords: Array<{ key: string; lat: number; lng: number }> = [];
  for (const a of activities) {
    if (a.startLat != null && a.startLng != null) {
      const key = coordKey(a.startLat, a.startLng);
      if (!coordToCity.has(key)) {
        coordToCity.set(key, null);
        uniqueCoords.push({ key, lat: a.startLat, lng: a.startLng });
      }
    }
  }
  return uniqueCoords;
}

/** Build city updates from the coord→city map, with timezone fallback for missing coords. */
function buildCityUpdates(
  activities: import("./types").ParsedStravaActivity[],
  coordToCity: Map<string, string | null>,
): Array<{ stravaActivityId: string; city: string }> {
  const updates: Array<{ stravaActivityId: string; city: string }> = [];
  for (const a of activities) {
    let city: string | null = null;
    if (a.startLat != null && a.startLng != null) {
      city = coordToCity.get(coordKey(a.startLat, a.startLng)) ?? null;
    }
    if (!city) {
      city = cityFromTimezone(a.timezone);
    }
    if (city) {
      updates.push({ stravaActivityId: a.stravaActivityId, city });
    }
  }
  return updates;
}

/**
 * Reverse-geocode new activities to populate the city field.
 * Deduplicates by rounding coords to ~1km precision to minimize API calls.
 * Falls back to timezone parsing for privacy zone activities.
 */
async function backfillCities(
  activities: import("./types").ParsedStravaActivity[],
): Promise<void> {
  const coordToCity = new Map<string, string | null>();
  const uniqueCoords = collectUniqueCoords(activities, coordToCity);

  // Reverse geocode unique coordinates (parallel, max 10 concurrent)
  const BATCH_SIZE = 10;
  for (let i = 0; i < uniqueCoords.length; i += BATCH_SIZE) {
    const batch = uniqueCoords.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ lat, lng }) => reverseGeocode(lat, lng)),
    );
    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        coordToCity.set(batch[j].key, result.value);
      }
    }
  }

  const updates = buildCityUpdates(activities, coordToCity);
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(({ stravaActivityId, city }) =>
        prisma.stravaActivity.update({
          where: { stravaActivityId },
          data: { city },
        }),
      ),
    );
  }
}
