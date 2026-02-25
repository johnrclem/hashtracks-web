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

  const athleteData = connection.athleteData as {
    firstname?: string;
    lastname?: string;
  } | null;

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

  // Build canonical URL and update both records
  const stravaUrl = buildStravaUrl(activity.stravaActivityId);

  await prisma.$transaction([
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
