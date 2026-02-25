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

  // Upsert each activity
  let created = 0;
  let updated = 0;

  for (const raw of rawActivities) {
    const parsed = parseStravaActivity(raw);

    const existing = await prisma.stravaActivity.findUnique({
      where: { stravaActivityId: parsed.stravaActivityId },
      select: { id: true },
    });

    if (existing) {
      await prisma.stravaActivity.update({
        where: { stravaActivityId: parsed.stravaActivityId },
        data: {
          name: parsed.name,
          sportType: parsed.sportType,
          dateLocal: parsed.dateLocal,
          timeLocal: parsed.timeLocal,
          distanceMeters: parsed.distanceMeters,
          movingTimeSecs: parsed.movingTimeSecs,
          startLat: parsed.startLat,
          startLng: parsed.startLng,
          timezone: parsed.timezone,
        },
      });
      updated++;
    } else {
      await prisma.stravaActivity.create({
        data: {
          stravaConnectionId: connection.id,
          stravaActivityId: parsed.stravaActivityId,
          name: parsed.name,
          sportType: parsed.sportType,
          dateLocal: parsed.dateLocal,
          timeLocal: parsed.timeLocal,
          distanceMeters: parsed.distanceMeters,
          movingTimeSecs: parsed.movingTimeSecs,
          startLat: parsed.startLat,
          startLng: parsed.startLng,
          timezone: parsed.timezone,
        },
      });
      created++;
    }
  }

  // Update lastSyncAt
  await prisma.stravaConnection.update({
    where: { id: connection.id },
    data: { lastSyncAt: new Date() },
  });

  return { created, updated, total: rawActivities.length };
}
