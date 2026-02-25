import { prisma } from "@/lib/db";
import {
  getValidAccessToken,
  fetchStravaActivities,
  parseStravaActivity,
} from "./client";

export interface SyncResult {
  created: number;
  updated: number;
  total: number;
  error?: string;
}

const LOOKBACK_DAYS = 90;
const STALE_HOURS = 6;

/**
 * Sync Strava activities for a user.
 *
 * - Lookback: 90 days from now
 * - Skips if lastSyncAt is within 6 hours (unless forceRefresh)
 * - Upserts activities by stravaActivityId
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
    return { created: 0, updated: 0, total: 0, error: "No Strava connection" };
  }

  // Check freshness (skip if synced recently)
  if (!options?.forceRefresh && connection.lastSyncAt) {
    const hoursSinceSync =
      (Date.now() - connection.lastSyncAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSync < STALE_HOURS) {
      return {
        created: 0,
        updated: 0,
        total: 0,
        error: "Sync skipped (recent)",
      };
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
    return { created: 0, updated: 0, total: 0, error: message };
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
    return { created: 0, updated: 0, total: 0, error: message };
  }

  // Parse all activities and batch by create vs update
  const parsed = rawActivities.map(parseStravaActivity);
  const stravaIds = parsed.map((p) => p.stravaActivityId);

  // Single query to find all existing activities
  const existingActivities = await prisma.stravaActivity.findMany({
    where: { stravaActivityId: { in: stravaIds } },
    select: { stravaActivityId: true },
  });
  const existingIdSet = new Set(existingActivities.map((a) => a.stravaActivityId));

  const toCreate = parsed.filter((p) => !existingIdSet.has(p.stravaActivityId));
  const toUpdate = parsed.filter((p) => existingIdSet.has(p.stravaActivityId));

  // Batch create new activities
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
      })),
    });
  }

  // Batch update existing activities in a single transaction
  if (toUpdate.length > 0) {
    await prisma.$transaction(
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
          },
        }),
      ),
    );
  }

  const created = toCreate.length;
  const updated = toUpdate.length;

  // Update lastSyncAt
  await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date() },
  });

  return { created, updated, total: rawActivities.length };
}
