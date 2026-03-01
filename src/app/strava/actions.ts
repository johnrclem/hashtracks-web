"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions";
import {
  deauthorizeStrava,
  getValidAccessToken,
  buildStravaUrl,
} from "@/lib/strava/client";
import { syncStravaActivities } from "@/lib/strava/sync";
import type { StravaActivityOption } from "@/lib/strava/types";

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
 * Get cached Strava activities for a specific date (+/- 1 day).
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

  // Parse the event date and compute +/- 1 day range
  const [year, month, day] = eventDate.split("-").map(Number);
  const eventDateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayBefore = new Date(eventDateObj.getTime() - 24 * 60 * 60 * 1000);
  const dayAfter = new Date(eventDateObj.getTime() + 24 * 60 * 60 * 1000);

  const formatDate = (d: Date) =>
    d.toISOString().substring(0, 10); // "YYYY-MM-DD"

  const dateRange = [
    formatDate(dayBefore),
    eventDate,
    formatDate(dayAfter),
  ];

  const activities = await prisma.stravaActivity.findMany({
    where: {
      stravaConnectionId: connection.id,
      dateLocal: { in: dateRange },
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
  eventDate: string;
  activityName: string;
  distanceMeters: number;
}

/**
 * Find confirmed attendances (last 90 days, no stravaUrl) that have
 * matching StravaActivities (by date ±1 day, unmatched, not dismissed).
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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

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
            kennel: { select: { shortName: true } },
          },
        },
      },
      orderBy: { event: { date: "desc" } },
      take: 50,
    });

    if (attendances.length === 0) return { success: true, matches: [] };

    // Compute date range for DB filter (±1 day around attendance window)
    const attDates = attendances.map((a) => a.event.date.getTime());
    const earliest = new Date(Math.min(...attDates));
    earliest.setUTCDate(earliest.getUTCDate() - 1);
    const latest = new Date(Math.max(...attDates));
    latest.setUTCDate(latest.getUTCDate() + 1);

    // Get unmatched, non-dismissed Strava activities within date range
    const activities = await prisma.stravaActivity.findMany({
      where: {
        stravaConnectionId: connection.id,
        matchedAttendanceId: null,
        matchDismissed: false,
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

    // Match attendances to activities by date ±1 day
    const matches: UnmatchedStravaMatch[] = [];

    for (const att of attendances) {
      const eventDate = att.event.date;
      const eventDateStr = eventDate.toISOString().substring(0, 10);
      const dBefore = new Date(eventDate);
      dBefore.setUTCDate(dBefore.getUTCDate() - 1);
      const dayBefore = dBefore.toISOString().substring(0, 10);
      const dAfter = new Date(eventDate);
      dAfter.setUTCDate(dAfter.getUTCDate() + 1);
      const dayAfter = dAfter.toISOString().substring(0, 10);

      for (const dateKey of [dayBefore, eventDateStr, dayAfter]) {
        const candidates = activityByDate.get(dateKey);
        if (!candidates) continue;
        for (const activity of candidates) {
          matches.push({
            stravaActivityDbId: activity.id,
            attendanceId: att.id,
            kennelShortName: att.event.kennel.shortName,
            eventDate: eventDateStr,
            activityName: activity.name,
            distanceMeters: activity.distanceMeters,
          });
        }
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
