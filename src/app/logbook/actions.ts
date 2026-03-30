"use server";

import { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTodayUtcNoon, parseUtcNoonDate } from "@/lib/date";
import { parseParticipationLevel } from "@/lib/format";
import { buildStravaUrl } from "@/lib/strava/url";
import type { ActionResult } from "@/lib/actions";
import { revalidatePath } from "next/cache";

/**
 * Shared check-in logic: validates event, checks date, upserts attendance.
 * Returns the attendanceId and whether a new record was created, or an error.
 */
async function ensureCheckIn(
  userId: string,
  eventId: string,
  participationLevel?: string,
): Promise<{ attendanceId: string; isNew: boolean } | { error: string }> {
  // Validate event exists
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, date: true },
  });
  if (!event) return { error: "Event not found" };

  // Validate event is today or in the past (UTC noon comparison)
  const todayUtcNoon = getTodayUtcNoon();
  if (event.date.getTime() > todayUtcNoon) {
    return { error: "Can only check in to today's or past events" };
  }

  // Check for existing attendance (handle race conditions + RSVP upgrade)
  const existing = await prisma.attendance.findUnique({
    where: { userId_eventId: { userId, eventId } },
  });
  if (existing) {
    // If INTENDING, upgrade to CONFIRMED
    if (existing.status === "INTENDING") {
      await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          status: "CONFIRMED",
          participationLevel: parseParticipationLevel(participationLevel),
        },
      });
    }
    return { attendanceId: existing.id, isNew: false };
  }

  const attendance = await prisma.attendance.create({
    data: {
      userId,
      eventId,
      status: "CONFIRMED",
      participationLevel: parseParticipationLevel(participationLevel),
    },
  });

  return { attendanceId: attendance.id, isNew: true };
}

export async function checkIn(
  eventId: string,
  participationLevel?: string,
): Promise<ActionResult<{ attendanceId: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const result = await ensureCheckIn(user.id, eventId, participationLevel);
  if ("error" in result) return { error: result.error };

  // Server-side analytics capture
  const { captureServerEvent } = await import("@/lib/analytics-server");
  captureServerEvent(user.id, "check_in", {
    kennelSlug: eventId,
    status: "confirmed",
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true, attendanceId: result.attendanceId };
}

export async function updateAttendance(
  attendanceId: string,
  data: {
    participationLevel?: string;
    stravaUrl?: string | null;
    notes?: string | null;
  },
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate ownership
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };

  // Input length validation
  if (data.stravaUrl && data.stravaUrl.length > 500) return { error: "Strava URL is too long (max 500 characters)" };
  if (data.notes && data.notes.length > 1000) return { error: "Notes are too long (max 1,000 characters)" };

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      ...(data.participationLevel !== undefined && {
        participationLevel: parseParticipationLevel(data.participationLevel),
      }),
      ...(data.stravaUrl !== undefined && { stravaUrl: data.stravaUrl }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true };
}

export async function rsvp(eventId: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate event exists
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, date: true },
  });
  if (!event) return { error: "Event not found" };

  // Validate event is in the future — today's events can be checked in, not RSVP'd
  const todayUtcNoon = getTodayUtcNoon();
  if (event.date.getTime() <= todayUtcNoon) {
    return { error: "Can only RSVP to future events" };
  }

  // Toggle: if already INTENDING, remove it
  const existing = await prisma.attendance.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (existing) {
    if (existing.status === "INTENDING") {
      await prisma.attendance.delete({ where: { id: existing.id } });
      revalidatePath("/hareline");
      revalidatePath("/logbook");
      return { success: true, toggled: "off" };
    }
    // Already confirmed — don't allow toggling off
    return { success: true, attendanceId: existing.id };
  }

  const attendance = await prisma.attendance.create({
    data: {
      userId: user.id,
      eventId,
      status: "INTENDING",
      participationLevel: "RUN",
    },
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true, attendanceId: attendance.id, toggled: "on" };
}

/** Confirm a user's INTENDING attendance — upgrades it to CONFIRMED. */
export async function confirmAttendance(
  attendanceId: string,
  participationLevel?: string,
): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: { event: { select: { date: true, status: true } } },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };
  if (attendance.status !== "INTENDING") return { error: "Already confirmed" };

  // Validate event is today or in the past
  const todayUtcNoon = getTodayUtcNoon();
  if (attendance.event.date.getTime() > todayUtcNoon) {
    return { error: "Event hasn't happened yet" };
  }

  // Block confirmation of cancelled events
  if (attendance.event.status === "CANCELLED") {
    return { error: "Event was cancelled" };
  }

  await prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      status: "CONFIRMED",
      participationLevel: participationLevel ? parseParticipationLevel(participationLevel) : attendance.participationLevel,
    },
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true };
}

export async function deleteAttendance(attendanceId: string): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate ownership
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };

  // Clear any Strava activity match pointing to this attendance (prevent orphans)
  await prisma.stravaActivity.updateMany({
    where: { matchedAttendanceId: attendanceId },
    data: { matchedAttendanceId: null },
  });

  await prisma.attendance.delete({
    where: { id: attendanceId },
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true };
}

// ── Check-In with Strava (combined check-in + Strava attachment) ──

/**
 * Check in to an event and attach a Strava activity in one action.
 * Used by StravaSuggestions "I Was There" button — creates attendance if needed,
 * then links the Strava activity.
 */
export async function checkInWithStrava(
  eventId: string,
  stravaActivityDbId: string,
  participationLevel?: string,
): Promise<ActionResult<{ attendanceId: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const result = await ensureCheckIn(user.id, eventId, participationLevel);
  if ("error" in result) return { error: result.error };

  const { attendanceId } = result;

  // Verify user owns the Strava activity (via connection)
  const activity = await prisma.stravaActivity.findUnique({
    where: { id: stravaActivityDbId },
    include: { connection: { select: { userId: true } } },
  });
  if (!activity) return { error: "Strava activity not found" };
  if (activity.connection.userId !== user.id) return { error: "Not authorized" };

  // Build Strava URL and link in a transaction
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
  return { success: true, attendanceId };
}

// ── PENDING CONFIRMATIONS (from misman attendance records) ──

/**
 * Get misman-recorded attendance that the user hasn't checked into their logbook.
 * Requires a CONFIRMED KennelHasherLink between the user and a KennelHasher.
 */
export async function getPendingConfirmations() {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Get all CONFIRMED links for this user
  const links = await prisma.kennelHasherLink.findMany({
    where: { userId: user.id, status: "CONFIRMED" },
    select: { kennelHasherId: true },
  });

  if (links.length === 0) return { data: [] };

  const kennelHasherIds = links.map((l) => l.kennelHasherId);

  // Get misman attendance records for those hashers (exclude cancelled events)
  const mismanRecords = await prisma.kennelAttendance.findMany({
    where: {
      kennelHasherId: { in: kennelHasherIds },
      event: { status: { not: "CANCELLED" } },
    },
    include: {
      event: {
        select: {
          id: true,
          date: true,
          title: true,
          runNumber: true,
          status: true,
          kennel: { select: { shortName: true, fullName: true } },
        },
      },
    },
    orderBy: { event: { date: "desc" } },
    take: 50,
  });

  if (mismanRecords.length === 0) return { data: [] };

  // Get user's existing attendance event IDs
  const eventIds = mismanRecords.map((r) => r.eventId);
  const userAttendances = await prisma.attendance.findMany({
    where: { userId: user.id, eventId: { in: eventIds } },
    select: { eventId: true },
  });
  const attendedEventIds = new Set(userAttendances.map((a) => a.eventId));

  // Filter to only those without a matching user attendance
  const pending = mismanRecords
    .filter((r) => !attendedEventIds.has(r.eventId))
    .map((r) => ({
      kennelAttendanceId: r.id,
      eventId: r.eventId,
      eventDate: r.event.date.toISOString(),
      eventTitle: r.event.title,
      runNumber: r.event.runNumber,
      kennelShortName: r.event.kennel.shortName,
      kennelFullName: r.event.kennel.fullName,
      haredThisTrail: r.haredThisTrail,
    }));

  return { data: pending };
}

/**
 * Shared validation for misman attendance actions (confirm/decline).
 * Authenticates the user, fetches the misman record, validates the
 * kennel-hasher link, and checks for an existing logbook entry.
 */
async function resolveMismanRecord(kennelAttendanceId: string): Promise<
  | { ok: false; error: string }
  | { ok: true; user: { id: string }; mismanRecord: NonNullable<Awaited<ReturnType<typeof prisma.kennelAttendance.findUnique>>> & { event: { status: string } }; existing: Awaited<ReturnType<typeof prisma.attendance.findUnique>> }
> {
  const user = await getOrCreateUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const mismanRecord = await prisma.kennelAttendance.findUnique({
    where: { id: kennelAttendanceId },
    include: {
      kennelHasher: {
        include: {
          userLink: { select: { userId: true, status: true } },
        },
      },
      event: { select: { status: true } },
    },
  });

  if (!mismanRecord) return { ok: false, error: "Attendance record not found" };

  const link = mismanRecord.kennelHasher.userLink;
  if (!link || link.status !== "CONFIRMED" || link.userId !== user.id) {
    return { ok: false, error: "Not authorized — no confirmed link to this hasher" };
  }

  const existing = await prisma.attendance.findUnique({
    where: { userId_eventId: { userId: user.id, eventId: mismanRecord.eventId } },
  });

  return { ok: true, user, mismanRecord, existing };
}

/**
 * Confirm a misman attendance record into the user's logbook.
 * Creates an Attendance record with participation level based on haredThisTrail.
 */
export async function confirmMismanAttendance(kennelAttendanceId: string): Promise<ActionResult<{ attendanceId: string }>> {
  const resolved = await resolveMismanRecord(kennelAttendanceId);
  if (!resolved.ok) return { error: resolved.error };
  const { user, mismanRecord, existing } = resolved;

  if (existing) return { success: true, attendanceId: existing.id };

  // Block confirmation of cancelled events
  if (mismanRecord.event.status === "CANCELLED") {
    return { error: "Event was cancelled" };
  }

  try {
    const attendance = await prisma.attendance.create({
      data: {
        userId: user.id,
        eventId: mismanRecord.eventId,
        status: "CONFIRMED",
        participationLevel: mismanRecord.haredThisTrail ? "HARE" : "RUN",
        isVerified: true,
        verifiedBy: mismanRecord.recordedBy,
      },
    });

    revalidatePath("/logbook");
    return { success: true, attendanceId: attendance.id };
  } catch (e) {
    // Concurrent insert won the race — treat as idempotent success
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await prisma.attendance.findUnique({
        where: { userId_eventId: { userId: user.id, eventId: mismanRecord.eventId } },
      });
      if (!raced) return { error: "Unable to confirm — please try again later" };
      revalidatePath("/logbook");
      return { success: true, attendanceId: raced.id };
    }
    console.error("[confirmMismanAttendance] Unhandled error:", e);
    return { error: "Unable to confirm — please try again later" };
  }
}

/**
 * Decline a misman attendance record — the user says they weren't there.
 * Creates an Attendance record with status DECLINED so the pending confirmation
 * won't reappear (getPendingConfirmations filters events with any Attendance record).
 */
// ── Quick-Add: Search Events ──

export type SearchEventResult = {
  id: string;
  date: string; // ISO string
  title: string | null;
  runNumber: number | null;
  startTime: string | null;
  locationName: string | null;
  kennelShortName: string;
  kennelFullName: string;
  kennelSlug: string;
  region: string;
  alreadyAttended: boolean;
};

export async function searchEvents(params: {
  kennelQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<ActionResult<{ events: SearchEventResult[] }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const todayNoon = new Date(getTodayUtcNoon());

    const commonFilters = {
      status: { not: "CANCELLED" as const },
      isManualEntry: { not: true },
      kennel: { isHidden: false },
    };

    let events: Array<{
      id: string;
      date: Date;
      title: string | null;
      runNumber: number | null;
      startTime: string | null;
      locationName: string | null;
      kennel: { shortName: string; fullName: string; slug: string; region: string };
    }>;

    if (params.kennelQuery) {
      // Search by kennel name
      const dateFilters: Record<string, unknown> = { lte: todayNoon };
      if (params.dateFrom) dateFilters.gte = new Date(params.dateFrom + "T12:00:00Z");
      if (params.dateTo) dateFilters.lte = new Date(params.dateTo + "T12:00:00Z");

      events = await prisma.event.findMany({
        where: {
          ...commonFilters,
          date: dateFilters as { lte: Date; gte?: Date },
          kennel: {
            isHidden: false,
            OR: [
              { shortName: { contains: params.kennelQuery, mode: "insensitive" } },
              { fullName: { contains: params.kennelQuery, mode: "insensitive" } },
            ],
          },
        },
        include: {
          kennel: { select: { shortName: true, fullName: true, slug: true, region: true } },
        },
        orderBy: { date: "desc" },
        take: params.limit ?? 20,
      });
    } else {
      // Smart defaults: subscribed kennels, recent time window
      const [subscriptions, lastCheckIn] = await Promise.all([
        prisma.userKennel.findMany({
          where: { userId: user.id },
          select: { kennelId: true },
        }),
        prisma.attendance.findFirst({
          where: { userId: user.id, status: "CONFIRMED" },
          orderBy: { event: { date: "desc" } },
          select: { event: { select: { date: true } } },
        }),
      ]);

      if (subscriptions.length === 0) {
        return { success: true, events: [] };
      }

      const kennelIds = subscriptions.map((s) => s.kennelId);

      const windowStart = lastCheckIn
        ? lastCheckIn.event.date
        : new Date(todayNoon.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      events = await prisma.event.findMany({
        where: {
          ...commonFilters,
          kennelId: { in: kennelIds },
          date: { gte: windowStart, lte: todayNoon },
        },
        include: {
          kennel: { select: { shortName: true, fullName: true, slug: true, region: true } },
        },
        orderBy: { date: "desc" },
        take: params.limit ?? 15,
      });
    }

    if (events.length === 0) {
      return { success: true, events: [] };
    }

    // Batch check existing attendance
    const eventIds = events.map((e) => e.id);
    const existingAttendances = await prisma.attendance.findMany({
      where: { userId: user.id, eventId: { in: eventIds } },
      select: { eventId: true },
    });
    const attendedSet = new Set(existingAttendances.map((a) => a.eventId));

    const results: SearchEventResult[] = events.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      title: e.title,
      runNumber: e.runNumber,
      startTime: e.startTime,
      locationName: e.locationName,
      kennelShortName: e.kennel.shortName,
      kennelFullName: e.kennel.fullName,
      kennelSlug: e.kennel.slug,
      region: e.kennel.region,
      alreadyAttended: attendedSet.has(e.id),
    }));

    return { success: true, events: results };
  } catch (err) {
    console.error("Failed to search events:", err);
    return { error: "Failed to search events" };
  }
}

export async function declineMismanAttendance(kennelAttendanceId: string): Promise<ActionResult> {
  const resolved = await resolveMismanRecord(kennelAttendanceId);
  if (!resolved.ok) return { error: resolved.error };
  const { user, mismanRecord, existing } = resolved;

  if (existing) return { success: true };

  try {
    await prisma.attendance.create({
      data: {
        userId: user.id,
        eventId: mismanRecord.eventId,
        status: "DECLINED",
        participationLevel: "RUN",
      },
    });
  } catch (e) {
    // Concurrent insert won the race — treat as idempotent success
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      revalidatePath("/logbook");
      return { success: true };
    }
    console.error("[declineMismanAttendance] Unhandled error:", e);
    return { error: "Unable to decline — please try again later" };
  }

  revalidatePath("/logbook");
  return { success: true };
}

// ── Log Unlisted Run ──

export async function createManualEvent(data: {
  kennelId: string;
  date: string; // "YYYY-MM-DD"
  title?: string;
  locationName?: string;
  participationLevel?: string;
  notes?: string;
}): Promise<ActionResult<{ eventId: string; attendanceId: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate kennel exists and is not hidden
  const kennel = await prisma.kennel.findUnique({
    where: { id: data.kennelId },
    select: { id: true, isHidden: true },
  });
  if (!kennel) return { error: "Kennel not found" };
  if (kennel.isHidden) return { error: "Kennel is not available" };

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return { error: "Invalid date format" };
  }

  // Parse to UTC noon
  const utcNoon = parseUtcNoonDate(data.date);
  if (Number.isNaN(utcNoon.getTime())) {
    return { error: "Invalid date" };
  }

  // Validate date is today or in the past
  const todayUtcNoon = getTodayUtcNoon();
  if (utcNoon.getTime() > todayUtcNoon) {
    return { error: "Can only log runs for today or past dates" };
  }

  // Input length validation
  if (data.title && data.title.length > 200) return { error: "Trail name is too long (max 200 characters)" };
  if (data.locationName && data.locationName.length > 200) return { error: "Location is too long (max 200 characters)" };
  if (data.notes && data.notes.length > 1000) return { error: "Notes are too long (max 1,000 characters)" };

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        kennelId: data.kennelId,
        date: utcNoon,
        title: data.title || null,
        locationName: data.locationName || null,
        isManualEntry: true,
        submittedByUserId: user.id,
        trustLevel: 3,
        status: "CONFIRMED",
      },
    });

    const attendance = await tx.attendance.create({
      data: {
        userId: user.id,
        eventId: event.id,
        status: "CONFIRMED",
        participationLevel: parseParticipationLevel(data.participationLevel),
        notes: data.notes || null,
      },
    });

    return { event, attendance };
  });

  revalidatePath("/logbook");
  return { success: true, eventId: result.event.id, attendanceId: result.attendance.id };
}

// ── Kennel Search (for Log Unlisted Run) ──

export async function searchKennels(query: string): Promise<
  ActionResult<{ kennels: Array<{ id: string; shortName: string; fullName: string; region: string }> }>
> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  if (!query || query.trim().length === 0) {
    return { success: true, kennels: [] };
  }

  const kennels = await prisma.kennel.findMany({
    where: {
      isHidden: false,
      OR: [
        { shortName: { contains: query, mode: "insensitive" } },
        { fullName: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, shortName: true, fullName: true, region: true },
    orderBy: { shortName: "asc" },
    take: 10,
  });

  return {
    success: true,
    kennels: kennels.map((k) => ({
      id: k.id,
      shortName: k.shortName,
      fullName: k.fullName,
      region: k.region,
    })),
  };
}
