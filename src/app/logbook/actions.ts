"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

  // Validate event is in the past (UTC noon comparison)
  const now = new Date();
  const todayUtcNoon = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
  if (event.date.getTime() >= todayUtcNoon) {
    return { error: "Can only check in to past events" };
  }

  // Check for existing attendance (handle race conditions)
  const existing = await prisma.attendance.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (existing) return { success: true, attendanceId: existing.id };

  const attendance = await prisma.attendance.create({
    data: {
      userId: user.id,
      eventId,
      participationLevel: (participationLevel as "RUN" | "HARE" | "BAG_HERO" | "DRINK_CHECK" | "BEER_MILE" | "WALK" | "CIRCLE_ONLY") ?? "RUN",
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
        participationLevel: data.participationLevel as "RUN" | "HARE" | "BAG_HERO" | "DRINK_CHECK" | "BEER_MILE" | "WALK" | "CIRCLE_ONLY",
      }),
      ...(data.stravaUrl !== undefined && { stravaUrl: data.stravaUrl }),
      ...(data.notes !== undefined && { notes: data.notes }),
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
