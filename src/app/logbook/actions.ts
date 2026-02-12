"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseParticipationLevel } from "@/lib/format";
import { revalidatePath } from "next/cache";

export async function checkIn(
  eventId: string,
  participationLevel?: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate event exists
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, date: true },
  });
  if (!event) return { error: "Event not found" };

  // Validate event is today or in the past (UTC noon comparison)
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
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
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Validate ownership
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };

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
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
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
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: { event: { select: { date: true } } },
  });
  if (!attendance) return { error: "Attendance not found" };
  if (attendance.userId !== user.id) return { error: "Not authorized" };
  if (attendance.status !== "INTENDING") return { error: "Already confirmed" };

  // Validate event is today or in the past
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
  if (attendance.event.date.getTime() > todayUtcNoon) {
    return { error: "Event hasn't happened yet" };
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

export async function deleteAttendance(attendanceId: string) {
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
