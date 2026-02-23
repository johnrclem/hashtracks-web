"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTodayUtcNoon } from "@/lib/date";
import { parseParticipationLevel } from "@/lib/format";
import type { ActionResult } from "@/lib/actions";
import { revalidatePath } from "next/cache";

export async function checkIn(
  eventId: string,
  participationLevel?: string,
): Promise<ActionResult<{ attendanceId: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

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
    where: { userId_eventId: { userId: user.id, eventId } },
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
      revalidatePath("/hareline");
      revalidatePath("/logbook");
    }
    return { success: true, attendanceId: existing.id };
  }

  const attendance = await prisma.attendance.create({
    data: {
      userId: user.id,
      eventId,
      status: "CONFIRMED",
      participationLevel: parseParticipationLevel(participationLevel),
    },
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true, attendanceId: attendance.id };
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

  await prisma.attendance.delete({
    where: { id: attendanceId },
  });

  revalidatePath("/hareline");
  revalidatePath("/logbook");
  return { success: true };
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
          kennel: { select: { shortName: true } },
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
      haredThisTrail: r.haredThisTrail,
    }));

  return { data: pending };
}

/**
 * Confirm a misman attendance record into the user's logbook.
 * Creates an Attendance record with participation level based on haredThisTrail.
 */
export async function confirmMismanAttendance(kennelAttendanceId: string): Promise<ActionResult<{ attendanceId: string }>> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Verify the misman record exists and belongs to a linked hasher
  const mismanRecord = await prisma.kennelAttendance.findUnique({
    where: { id: kennelAttendanceId },
    include: {
      kennelHasher: {
        include: {
          userLink: { select: { userId: true, status: true } },
        },
      },
    },
  });

  if (!mismanRecord) return { error: "Attendance record not found" };

  const link = mismanRecord.kennelHasher.userLink;
  if (!link || link.status !== "CONFIRMED" || link.userId !== user.id) {
    return { error: "Not authorized — no confirmed link to this hasher" };
  }

  // Check for existing logbook entry (idempotent)
  const existing = await prisma.attendance.findUnique({
    where: { userId_eventId: { userId: user.id, eventId: mismanRecord.eventId } },
  });
  if (existing) {
    return { success: true, attendanceId: existing.id };
  }

  // Create logbook entry
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
}

/**
 * Decline a misman attendance record — the user says they weren't there.
 * Creates an Attendance record with status DECLINED so the pending confirmation
 * won't reappear (getPendingConfirmations filters events with any Attendance record).
 */
export async function declineMismanAttendance(kennelAttendanceId: string): Promise<ActionResult> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Verify the misman record exists and belongs to a linked hasher
  const mismanRecord = await prisma.kennelAttendance.findUnique({
    where: { id: kennelAttendanceId },
    include: {
      kennelHasher: {
        include: {
          userLink: { select: { userId: true, status: true } },
        },
      },
    },
  });

  if (!mismanRecord) return { error: "Attendance record not found" };

  const link = mismanRecord.kennelHasher.userLink;
  if (!link || link.status !== "CONFIRMED" || link.userId !== user.id) {
    return { error: "Not authorized — no confirmed link to this hasher" };
  }

  // Check for existing logbook entry (idempotent)
  const existing = await prisma.attendance.findUnique({
    where: { userId_eventId: { userId: user.id, eventId: mismanRecord.eventId } },
  });
  if (existing) {
    return { success: true };
  }

  // Create DECLINED logbook entry
  await prisma.attendance.create({
    data: {
      userId: user.id,
      eventId: mismanRecord.eventId,
      status: "DECLINED",
      participationLevel: "RUN",
    },
  });

  revalidatePath("/logbook");
  return { success: true };
}
