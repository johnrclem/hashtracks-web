"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions";
import {
  deauthorizeStrava,
  getValidAccessToken,
} from "@/lib/strava/client";
import { buildStravaUrl } from "@/lib/strava/url";
import { syncStravaActivities } from "@/lib/strava/sync";
import { scoreMatch } from "@/lib/strava/match-score";
import type { ScoreBreakdown } from "@/lib/strava/match-score";
import type { StravaActivityOption, LinkedStravaActivity } from "@/lib/strava/types";

// ── Module-level Constants ──

/** Sport types eligible for match scoring. */
const SCOREABLE_SPORTS = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);
const SCOREABLE_SPORTS_ARRAY = [...SCOREABLE_SPORTS];

// ── Internal Helpers ──

/** Compute the YYYY-MM-DD string for 90 days ago (Strava lookback window). */
function getStravaCutoffDateStr(): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  return cutoff.toISOString().substring(0, 10);
}

/** Group items with a `date: Date` field into a Map keyed by "YYYY-MM-DD". */
function groupByDateStr<T extends { date: Date }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const dateStr = item.date.toISOString().substring(0, 10);
    const existing = map.get(dateStr) ?? [];
    existing.push(item);
    map.set(dateStr, existing);
  }
  return map;
}

/** Find the best-scoring event match for a Strava activity among same-day candidates. */
function findBestEventMatch<
  T extends {
    kennel: { shortName: string };
    startTime: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone?: string | null;
  },
>(
  activity: {
    name: string;
    sportType: string;
    timeLocal: string | null;
    startLat: number | null;
    startLng: number | null;
    timezone?: string | null;
  },
  candidates: T[],
  threshold = 2.0,
): { event: T; score: number; breakdown: ScoreBreakdown } | null {
  let bestEvent: T | null = null;
  let bestScore = -1;
  let bestBreakdown: ScoreBreakdown | null = null;
  for (const ev of candidates) {
    const breakdown = scoreMatch(
      {
        activityName: activity.name,
        stravaSportType: activity.sportType,
        stravaTimeLocal: activity.timeLocal,
        startLat: activity.startLat,
        startLng: activity.startLng,
        timezone: activity.timezone,
      },
      ev.kennel.shortName,
      ev.startTime,
      ev.latitude,
      ev.longitude,
      ev.timezone,
    );
    if (breakdown.total > bestScore) {
      bestScore = breakdown.total;
      bestEvent = ev;
      bestBreakdown = breakdown;
    }
  }
  if (!bestEvent || !bestBreakdown || bestScore <= threshold) return null;

  // When geo doesn't confirm proximity (score 0 or negative), require a
  // strong name match. Blocks cross-geography false positives like
  // "Sav H3" vs "HVH3" (0.5) and "NYC H3" vs "W3H3" (0.33) while
  // allowing "NYC H3" vs "NYCH3" (0.83).
  if (bestBreakdown.geoScore <= 0 && bestBreakdown.nameScore < 0.6) return null;

  return { event: bestEvent, score: bestScore, breakdown: bestBreakdown };
}

// ── Connection Status ──

/** Get Strava connection status for the current user. */
export async function getStravaConnection(): Promise<
  ActionResult<{
    connected: boolean;
    athleteName?: string;
    lastSyncAt?: string;
    activityCount?: number;
  }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const connection = await prisma.stravaConnection.findUnique({
    where: { userId: user.id },
    include: { _count: { select: { activities: true } } },
  });

  if (!connection) {
    return { success: true, connected: false };
  }

  const athleteData = (
    connection.athleteData && typeof connection.athleteData === "object"
      ? connection.athleteData
      : null
  ) as { firstname?: string; lastname?: string } | null;

  const athleteName = athleteData
    ? [athleteData.firstname, athleteData.lastname].filter(Boolean).join(" ")
    : undefined;

  return {
    success: true,
    connected: true,
    athleteName: athleteName || undefined,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? undefined,
    activityCount: connection._count.activities,
  };
}

// ── Disconnect ──

/**
 * Disconnect Strava — revokes access + deletes all cached data.
 *
 * Per Strava API agreement (Nov 2024): must delete all personal data on deauthorization.
 * Only clears auto-populated stravaUrl values; manually-pasted URLs are preserved.
 */
export async function disconnectStrava(): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const connection = await prisma.stravaConnection.findUnique({
    where: { userId: user.id },
  });

  if (!connection) return { error: "No Strava connection found" };

  // Revoke access on Strava's end
  try {
    const { accessToken } = await getValidAccessToken(connection);
    await deauthorizeStrava(accessToken);
  } catch (err) {
    // Continue with local cleanup even if Strava revocation fails
    console.error("Strava deauthorization error (continuing cleanup):", err);
  }

  // Clear auto-populated stravaUrl on Attendance records (preserve manual URLs)
  const matchedActivities = await prisma.stravaActivity.findMany({
    where: {
      stravaConnectionId: connection.id,
      matchedAttendanceId: { not: null },
    },
    select: { matchedAttendanceId: true },
  });

  const attendanceIds = matchedActivities
    .map((a) => a.matchedAttendanceId)
    .filter((id): id is string => id !== null);

  if (attendanceIds.length > 0) {
    await prisma.attendance.updateMany({
      where: { id: { in: attendanceIds } },
      data: { stravaUrl: null },
    });
  }

  // Delete StravaConnection (cascade deletes all StravaActivity records)
  await prisma.stravaConnection.delete({
    where: { id: connection.id },
  });

  revalidatePath("/profile");
  revalidatePath("/logbook");
  return { success: true };
}

// ── Sync ──

/** Trigger a manual Strava activity sync. */
export async function triggerStravaSync(): Promise<
  ActionResult<{ syncedCount: number }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const result = await syncStravaActivities(user.id, { forceRefresh: true });

  if (result.error && result.total === 0) {
    return { error: result.error };
  }

  revalidatePath("/profile");
  return { success: true, syncedCount: result.total };
}

// ── Activity Lookup (for Edit Dialog dropdown) ──

/**
 * Get cached Strava activities for a specific date (same-day only).
 * Used by the EditAttendanceDialog "Pick from Strava" dropdown.
 * Only returns activities not already matched to another attendance.
 */
export async function getStravaActivitiesForDate(
  eventDate: string, // "YYYY-MM-DD"
): Promise<ActionResult<{ activities: StravaActivityOption[] }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const connection = await prisma.stravaConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  if (!connection) {
    return { success: true, activities: [] };
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return { error: "Invalid date format (expected YYYY-MM-DD)" };
  }

  const activities = await prisma.stravaActivity.findMany({
    where: {
      stravaConnectionId: connection.id,
      dateLocal: { equals: eventDate },
      matchedAttendanceId: null, // Not already matched
    },
    orderBy: { dateLocal: "asc" },
    select: {
      id: true,
      stravaActivityId: true,
      name: true,
      sportType: true,
      dateLocal: true,
      timeLocal: true,
      distanceMeters: true,
      movingTimeSecs: true,
      city: true,
    },
  });

  return { success: true, activities };
}

// ── Attach / Detach ──

/** Attach a Strava activity to an attendance record. */
export async function attachStravaActivity(
  stravaActivityDbId: string, // StravaActivity.id (cuid)
  attendanceId: string,
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate user owns the attendance
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    select: { userId: true },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };

  // Validate user owns the Strava activity (via connection)
  const activity = await prisma.stravaActivity.findUnique({
    where: { id: stravaActivityDbId },
    include: {
      connection: { select: { userId: true } },
    },
  });
  if (!activity) return { error: "Strava activity not found" };
  if (activity.connection.userId !== user.id) return { error: "Not authorized" };

  // Clear any previous match on this attendance (prevents stranded activities)
  const previousMatch = await prisma.stravaActivity.findFirst({
    where: { matchedAttendanceId: attendanceId },
    select: { id: true },
  });

  // Build canonical URL and update records in a single transaction
  const stravaUrl = buildStravaUrl(activity.stravaActivityId);

  await prisma.$transaction([
    // Clear previous match if one exists
    ...(previousMatch
      ? [
          prisma.stravaActivity.update({
            where: { id: previousMatch.id },
            data: { matchedAttendanceId: null },
          }),
        ]
      : []),
    // Set new match
    prisma.attendance.update({
      where: { id: attendanceId },
      data: { stravaUrl },
    }),
    prisma.stravaActivity.update({
      where: { id: stravaActivityDbId },
      data: { matchedAttendanceId: attendanceId },
    }),
  ]);

  revalidatePath("/logbook");
  return { success: true };
}

// ── Nudge: Unmatched Activities ──

export interface UnmatchedStravaMatch {
  stravaActivityDbId: string;
  attendanceId: string;
  kennelShortName: string;
  kennelRegion: string;
  eventDate: string;
  activityName: string;
  distanceMeters: number;
  // Event context
  eventId: string;
  kennelFullName: string;
  eventTitle: string | null;
  eventRunNumber: number | null;
  eventStartTime: string | null;
  eventLocationName: string | null;
  eventHaresText: string | null;
  // Strava activity context
  stravaSportType: string;
  stravaTimeLocal: string | null;
  stravaMovingTimeSecs: number;
  stravaActivityId: string;
  stravaCity: string | null;
}

/**
 * Find confirmed attendances (last 90 days, no stravaUrl) that have
 * matching StravaActivities (same-day only, unmatched, not dismissed).
 */
export async function getUnmatchedStravaActivities(): Promise<
  ActionResult<{ matches: UnmatchedStravaMatch[] }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const connection = await prisma.stravaConnection.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!connection) return { success: true, matches: [] };

    // Get confirmed attendances from last 90 days without a stravaUrl
    const cutoff = new Date(getStravaCutoffDateStr() + "T12:00:00Z");

    const attendances = await prisma.attendance.findMany({
      where: {
        userId: user.id,
        status: "CONFIRMED",
        stravaUrl: null,
        event: { date: { gte: cutoff } },
      },
      include: {
        event: {
          select: {
            id: true,
            date: true,
            title: true,
            runNumber: true,
            startTime: true,
            locationName: true,
            haresText: true,
            kennel: { select: { shortName: true, fullName: true, region: true } },
          },
        },
      },
      orderBy: { event: { date: "desc" } },
      take: 50,
    });

    if (attendances.length === 0) return { success: true, matches: [] };

    // Compute date range for DB filter (exact dates of attendances)
    const attDates = attendances.map((a) => a.event.date.getTime());
    const earliest = new Date(Math.min(...attDates));
    const latest = new Date(Math.max(...attDates));

    // Get unmatched, non-dismissed running Strava activities within date range
    const activities = await prisma.stravaActivity.findMany({
      where: {
        stravaConnectionId: connection.id,
        matchedAttendanceId: null,
        matchDismissed: false,
        sportType: { in: SCOREABLE_SPORTS_ARRAY },
        distanceMeters: { gte: 1000 },
        dateLocal: {
          gte: earliest.toISOString().substring(0, 10),
          lte: latest.toISOString().substring(0, 10),
        },
      },
      select: {
        id: true,
        name: true,
        dateLocal: true,
        distanceMeters: true,
        sportType: true,
        timeLocal: true,
        movingTimeSecs: true,
        stravaActivityId: true,
        city: true,
        timezone: true,
      },
    });

    if (activities.length === 0) return { success: true, matches: [] };

    // Build a map of activity dates for quick lookup (activity date → activities)
    const activityByDate = new Map<string, typeof activities>();
    for (const a of activities) {
      const existing = activityByDate.get(a.dateLocal) ?? [];
      existing.push(a);
      activityByDate.set(a.dateLocal, existing);
    }

    // Match attendances to activities by same-day only (capped to prevent combinatorial explosion)
    const MATCH_CAP = 50;
    const matches: UnmatchedStravaMatch[] = [];

    for (const att of attendances) {
      if (matches.length >= MATCH_CAP) break;
      const eventDate = att.event.date;
      const eventDateStr = eventDate.toISOString().substring(0, 10);

      const candidates = activityByDate.get(eventDateStr);
      if (!candidates) continue;
      for (const activity of candidates) {
        if (matches.length >= MATCH_CAP) break;
        matches.push({
          stravaActivityDbId: activity.id,
          attendanceId: att.id,
          kennelShortName: att.event.kennel.shortName,
          kennelRegion: att.event.kennel.region,
          eventDate: eventDateStr,
          activityName: activity.name,
          distanceMeters: activity.distanceMeters,
          // Event context
          eventId: att.event.id,
          kennelFullName: att.event.kennel.fullName,
          eventTitle: att.event.title,
          eventRunNumber: att.event.runNumber,
          eventStartTime: att.event.startTime,
          eventLocationName: att.event.locationName,
          eventHaresText: att.event.haresText,
          // Strava activity context
          stravaSportType: activity.sportType,
          stravaTimeLocal: activity.timeLocal,
          stravaMovingTimeSecs: activity.movingTimeSecs,
          stravaActivityId: activity.stravaActivityId,
          stravaCity: activity.city ?? null,
        });
      }
    }

    return { success: true, matches };
  } catch (err) {
    console.error("Failed to get unmatched Strava activities:", err);
    return { error: "Failed to load Strava matches" };
  }
}

/** Dismiss a Strava activity match suggestion (sets matchDismissed flag). */
export async function dismissStravaMatch(
  stravaActivityDbId: string,
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  try {
    // Validate user owns the activity via connection
    const activity = await prisma.stravaActivity.findUnique({
      where: { id: stravaActivityDbId },
      include: { connection: { select: { userId: true } } },
    });
    if (!activity) return { error: "Activity not found" };
    if (activity.connection.userId !== user.id) return { error: "Not authorized" };

    await prisma.stravaActivity.update({
      where: { id: stravaActivityDbId },
      data: { matchDismissed: true },
    });

    revalidatePath("/logbook");
    return { success: true };
  } catch (err) {
    console.error("Failed to dismiss Strava match:", err);
    return { error: "Failed to dismiss match" };
  }
}

/** Dismiss multiple Strava activity match suggestions in a single batch. */
export async function dismissAllStravaMatches(
  stravaActivityDbIds: string[],
): Promise<ActionResult<{ dismissedCount: number }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };
  if (stravaActivityDbIds.length === 0) return { success: true, dismissedCount: 0 };

  try {
    const result = await prisma.stravaActivity.updateMany({
      where: {
        id: { in: stravaActivityDbIds },
        connection: { userId: user.id },
      },
      data: { matchDismissed: true },
    });

    revalidatePath("/logbook");
    return { success: true, dismissedCount: result.count };
  } catch (err) {
    console.error("Failed to batch dismiss Strava matches:", err);
    return { error: "Failed to dismiss matches" };
  }
}

/** Detach a Strava activity from an attendance record. */
export async function detachStravaActivity(
  attendanceId: string,
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate user owns the attendance
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    select: { userId: true },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };

  // Find the matched StravaActivity
  const matchedActivity = await prisma.stravaActivity.findFirst({
    where: { matchedAttendanceId: attendanceId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.attendance.update({
      where: { id: attendanceId },
      data: { stravaUrl: null },
    }),
    // Only update StravaActivity if one was matched
    ...(matchedActivity
      ? [
          prisma.stravaActivity.update({
            where: { id: matchedActivity.id },
            data: { matchedAttendanceId: null },
          }),
        ]
      : []),
  ]);

  revalidatePath("/logbook");
  return { success: true };
}

// ── Linked Activity Details ──

/** Fetch the StravaActivity linked to a given attendance, if any. */
export async function getLinkedStravaActivity(
  attendanceId: string,
): Promise<ActionResult<{ activity: LinkedStravaActivity | null }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Verify user owns the attendance
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    select: { userId: true },
  });
  if (!attendance) return { success: true, activity: null };
  if (attendance.userId !== user.id) return { error: "Not authorized" };

  const activity = await prisma.stravaActivity.findFirst({
    where: { matchedAttendanceId: attendanceId },
    select: {
      name: true,
      sportType: true,
      distanceMeters: true,
      movingTimeSecs: true,
      timeLocal: true,
      city: true,
      stravaActivityId: true,
    },
  });

  return { success: true, activity: activity ?? null };
}

// ── Strava Event Suggestions ("Were you there?") ──

export interface StravaSuggestion {
  stravaActivityDbId: string;
  stravaActivityId: string;
  activityName: string;
  sportType: string;
  dateLocal: string;
  timeLocal: string | null;
  distanceMeters: number;
  movingTimeSecs: number;
  city: string | null;
  startLat: number | null;
  startLng: number | null;
  eventId: string;
  kennelShortName: string;
  kennelFullName: string;
  kennelSlug: string;
  kennelRegion: string;
  eventDate: string;
  eventTitle: string | null;
  eventRunNumber: number | null;
  eventStartTime: string | null;
  eventLocationName: string | null;
  eventLat: number | null;
  eventLng: number | null;
  matchScore: number;
  matchReasons: string[];
}

/**
 * Find Strava activities from the last 90 days that match events the user
 * hasn't checked into. Returns top-scoring suggestions (score >= 2.0).
 */
export async function getStravaEventSuggestions(
  opts?: { excludeActivityIds?: string[] },
): Promise<
  ActionResult<{ suggestions: StravaSuggestion[]; hasMore: boolean }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const connection = await prisma.stravaConnection.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!connection) return { success: true, suggestions: [], hasMore: false };

    // Get unmatched, non-dismissed Strava activities from last 90 days
    const cutoffDateStr = getStravaCutoffDateStr();

    const activities = await prisma.stravaActivity.findMany({
      where: {
        stravaConnectionId: connection.id,
        matchedAttendanceId: null,
        matchDismissed: false,
        dateLocal: { gte: cutoffDateStr },
        sportType: { in: SCOREABLE_SPORTS_ARRAY },
        distanceMeters: { gte: 1000 },
        ...(opts?.excludeActivityIds?.length
          ? { id: { notIn: opts.excludeActivityIds } }
          : {}),
      },
      select: {
        id: true,
        stravaActivityId: true,
        name: true,
        sportType: true,
        dateLocal: true,
        timeLocal: true,
        distanceMeters: true,
        movingTimeSecs: true,
        city: true,
        startLat: true,
        startLng: true,
        timezone: true,
      },
    });

    if (activities.length === 0) return { success: true, suggestions: [], hasMore: false };

    // Collect unique date strings and convert to UTC noon Date objects
    const uniqueDates = [...new Set(activities.map((a) => a.dateLocal))];
    const dateObjects = uniqueDates.map(
      (d) => new Date(d + "T12:00:00Z"),
    );

    // Batch query events on those dates where user has NO attendance AND not manual entry
    const events = await prisma.event.findMany({
      where: {
        date: { in: dateObjects },
        isManualEntry: { not: true },
        status: "CONFIRMED",
        attendances: { none: { userId: user.id } },
      },
      select: {
        id: true,
        date: true,
        title: true,
        runNumber: true,
        startTime: true,
        locationName: true,
        latitude: true,
        longitude: true,
        timezone: true,
        kennel: { select: { shortName: true, fullName: true, slug: true, region: true } },
      },
    });

    if (events.length === 0) return { success: true, suggestions: [], hasMore: false };

    // Build map of eventDate string -> events[]
    const eventsByDate = groupByDateStr(events);

    // For each activity, find same-day events and score; keep only the best match
    const suggestions: StravaSuggestion[] = [];

    for (const activity of activities) {
      const candidates = eventsByDate.get(activity.dateLocal);
      if (!candidates || candidates.length === 0) continue;

      const match = findBestEventMatch(activity, candidates);
      if (!match) continue;
      const { event: bestEvent, score: bestScore, breakdown: bestBreakdown } = match;

      // Build match reasons from breakdown (no re-computation needed)
      const matchReasons: string[] = ["Same day"];

      if (bestBreakdown.geoKm != null && bestBreakdown.geoKm <= 25) {
        matchReasons.push(`Within ${Math.round(bestBreakdown.geoKm)} km`);
      }

      if (bestBreakdown.nameScore > 0.5) {
        matchReasons.push(`Name: "${activity.name}"`);
      }

      if (bestBreakdown.timeScore > 0.5) {
        matchReasons.push("Similar time");
      }

      suggestions.push({
        stravaActivityDbId: activity.id,
        stravaActivityId: activity.stravaActivityId,
        activityName: activity.name,
        sportType: activity.sportType,
        dateLocal: activity.dateLocal,
        timeLocal: activity.timeLocal,
        distanceMeters: activity.distanceMeters,
        movingTimeSecs: activity.movingTimeSecs,
        city: activity.city,
        startLat: activity.startLat,
        startLng: activity.startLng,
        eventId: bestEvent.id,
        kennelShortName: bestEvent.kennel.shortName,
        kennelFullName: bestEvent.kennel.fullName,
        kennelSlug: bestEvent.kennel.slug,
        kennelRegion: bestEvent.kennel.region,
        eventDate: bestEvent.date.toISOString().substring(0, 10),
        eventTitle: bestEvent.title,
        eventRunNumber: bestEvent.runNumber,
        eventStartTime: bestEvent.startTime,
        eventLocationName: bestEvent.locationName,
        eventLat: bestEvent.latitude,
        eventLng: bestEvent.longitude,
        matchScore: bestScore,
        matchReasons,
      });
    }

    // Sort by match score desc, cap at 10
    suggestions.sort((a, b) => b.matchScore - a.matchScore);
    const CAP = 10;
    const hasMore = suggestions.length > CAP;
    const capped = suggestions.slice(0, CAP);

    return { success: true, suggestions: capped, hasMore };
  } catch (err) {
    console.error("Failed to get Strava event suggestions:", err);
    return { error: "Failed to load Strava suggestions" };
  }
}

// ── Strava Backfill Wizard ──

export interface BackfillActivity {
  id: string;
  stravaActivityId: string;
  name: string;
  sportType: string;
  dateLocal: string;
  timeLocal: string | null;
  distanceMeters: number;
  movingTimeSecs: number;
  city: string | null;
  startLat: number | null;
  startLng: number | null;
  isMatched: boolean;
  isDismissed: boolean;
  candidateEvent: {
    eventId: string;
    kennelShortName: string;
    kennelFullName: string;
    eventTitle: string | null;
    eventRunNumber: number | null;
    eventDate: string;
    matchScore: number;
  } | null;
}

/**
 * Get ALL Strava activities from the last 90 days for the backfill wizard.
 * Includes matched, dismissed, and unreviewed activities.
 * Unmatched activities are scored against same-day events for candidate matches.
 */
export async function getStravaBackfillActivities(): Promise<
  ActionResult<{ activities: BackfillActivity[] }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const connection = await prisma.stravaConnection.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!connection) return { success: true, activities: [] };

    // Get ALL Strava activities from last 90 days
    const cutoffDateStr = getStravaCutoffDateStr();

    const allActivities = await prisma.stravaActivity.findMany({
      where: {
        stravaConnectionId: connection.id,
        dateLocal: { gte: cutoffDateStr },
      },
      select: {
        id: true,
        stravaActivityId: true,
        name: true,
        sportType: true,
        dateLocal: true,
        timeLocal: true,
        distanceMeters: true,
        movingTimeSecs: true,
        city: true,
        startLat: true,
        startLng: true,
        timezone: true,
        matchedAttendanceId: true,
        matchDismissed: true,
      },
      orderBy: { dateLocal: "desc" },
      take: 200,
    });

    if (allActivities.length === 0) return { success: true, activities: [] };

    // Collect unique dateLocal values from UNMATCHED, NON-DISMISSED activities
    const unmatchedDates = new Set<string>();
    for (const a of allActivities) {
      if (!a.matchedAttendanceId && !a.matchDismissed) {
        unmatchedDates.add(a.dateLocal);
      }
    }

    // Batch query events on those dates where user has no attendance
    const dateObjects = [...unmatchedDates].map(
      (d) => new Date(d + "T12:00:00Z"),
    );

    const candidateEvents =
      dateObjects.length > 0
        ? await prisma.event.findMany({
            where: {
              date: { in: dateObjects },
              isManualEntry: { not: true },
              status: "CONFIRMED",
              attendances: { none: { userId: user.id } },
              kennel: { isHidden: false },
            },
            select: {
              id: true,
              date: true,
              title: true,
              runNumber: true,
              startTime: true,
              latitude: true,
              longitude: true,
              timezone: true,
              kennel: { select: { shortName: true, fullName: true } },
            },
          })
        : [];

    // Build map of eventDate string -> events[]
    const eventsByDate = groupByDateStr(candidateEvents);

    // Build BackfillActivity list
    const activities: BackfillActivity[] = allActivities.map((a) => {
      const isMatched = a.matchedAttendanceId !== null;
      const isDismissed = a.matchDismissed;

      let candidateEvent: BackfillActivity["candidateEvent"] = null;

      // Only score unmatched, non-dismissed, running activities (show all in wizard)
      if (!isMatched && !isDismissed && SCOREABLE_SPORTS.has(a.sportType) && a.distanceMeters >= 1000) {
        const candidates = eventsByDate.get(a.dateLocal);
        if (candidates && candidates.length > 0) {
          const match = findBestEventMatch(a, candidates);
          if (match) {
            candidateEvent = {
              eventId: match.event.id,
              kennelShortName: match.event.kennel.shortName,
              kennelFullName: match.event.kennel.fullName,
              eventTitle: match.event.title,
              eventRunNumber: match.event.runNumber,
              eventDate: match.event.date.toISOString().substring(0, 10),
              matchScore: match.score,
            };
          }
        }
      }

      return {
        id: a.id,
        stravaActivityId: a.stravaActivityId,
        name: a.name,
        sportType: a.sportType,
        dateLocal: a.dateLocal,
        timeLocal: a.timeLocal,
        distanceMeters: a.distanceMeters,
        movingTimeSecs: a.movingTimeSecs,
        city: a.city,
        startLat: a.startLat,
        startLng: a.startLng,
        isMatched,
        isDismissed,
        candidateEvent,
      };
    });

    return { success: true, activities };
  } catch (err) {
    console.error("Failed to get Strava backfill activities:", err);
    return { error: "Failed to load Strava activities" };
  }
}

// ── Undismiss (Undo) ──

/** Undismiss a previously dismissed Strava activity match (for "Undo" in backfill wizard). */
export async function undismissStravaMatch(
  stravaActivityDbId: string,
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  try {
    // Validate user owns the activity via connection
    const activity = await prisma.stravaActivity.findUnique({
      where: { id: stravaActivityDbId },
      include: { connection: { select: { userId: true } } },
    });
    if (!activity) return { error: "Activity not found" };
    if (activity.connection.userId !== user.id) return { error: "Not authorized" };

    await prisma.stravaActivity.update({
      where: { id: stravaActivityDbId },
      data: { matchDismissed: false },
    });

    revalidatePath("/logbook");
    return { success: true };
  } catch (err) {
    console.error("Failed to undismiss Strava match:", err);
    return { error: "Failed to undo dismissal" };
  }
}
