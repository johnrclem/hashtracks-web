"use server";

import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

/**
 * Delete a single canonical Event and cascade-clean related records.
 * RawEvents are preserved (immutable audit trail) but unlinked.
 */
export async function deleteEvent(eventId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { kennel: { select: { shortName: true } } },
  });
  if (!event) return { error: "Event not found" };

  await prisma.$transaction([
    // Unlink RawEvents (preserve immutable audit trail)
    prisma.rawEvent.updateMany({
      where: { eventId },
      data: { eventId: null, processed: false },
    }),
    // Delete dependent records
    prisma.eventHare.deleteMany({ where: { eventId } }),
    prisma.attendance.deleteMany({ where: { eventId } }),
    // Delete the event itself
    prisma.event.delete({ where: { id: eventId } }),
  ]);

  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  return {
    success: true,
    kennelName: event.kennel.shortName,
    date: event.date.toISOString(),
  };
}

/**
 * Preview bulk delete — returns count and sample events without mutating.
 */
export async function previewBulkDelete(filters: {
  kennelId?: string;
  sourceId?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const where = buildEventWhere(filters);
  if (!where) return { error: "At least one filter is required" };

  const [count, sampleEvents] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      include: {
        kennel: { select: { shortName: true } },
        _count: { select: { attendances: true } },
      },
      orderBy: { date: "desc" },
      take: 5,
    }),
  ]);

  const totalAttendances = sampleEvents.reduce(
    (sum, e) => sum + e._count.attendances,
    0,
  );

  return {
    success: true,
    count,
    totalAttendances,
    sampleEvents: sampleEvents.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      kennelName: e.kennel.shortName,
      title: e.title,
      attendanceCount: e._count.attendances,
    })),
  };
}

/**
 * Bulk delete events matching filters.
 */
export async function bulkDeleteEvents(filters: {
  kennelId?: string;
  sourceId?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const where = buildEventWhere(filters);
  if (!where) return { error: "At least one filter is required" };

  const events = await prisma.event.findMany({
    where,
    select: { id: true },
  });

  if (events.length === 0) return { success: true, deletedCount: 0 };

  const eventIds = events.map((e) => e.id);

  await prisma.$transaction([
    // Unlink RawEvents
    prisma.rawEvent.updateMany({
      where: { eventId: { in: eventIds } },
      data: { eventId: null, processed: false },
    }),
    // Delete dependent records
    prisma.eventHare.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.attendance.deleteMany({ where: { eventId: { in: eventIds } } }),
    // Delete events
    prisma.event.deleteMany({ where: { id: { in: eventIds } } }),
  ]);

  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  return { success: true, deletedCount: eventIds.length };
}

/**
 * Build Prisma where clause from filters.
 * Returns null if no filters are provided (safety guard against accidental mass delete).
 */
function buildEventWhere(filters: {
  kennelId?: string;
  sourceId?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const conditions: Record<string, unknown>[] = [];

  if (filters.kennelId) {
    conditions.push({ kennelId: filters.kennelId });
  }

  if (filters.sourceId) {
    conditions.push({
      rawEvents: { some: { sourceId: filters.sourceId } },
    });
  }

  if (filters.dateStart) {
    conditions.push({
      date: { gte: new Date(filters.dateStart + "T00:00:00Z") },
    });
  }

  if (filters.dateEnd) {
    conditions.push({
      date: { lte: new Date(filters.dateEnd + "T23:59:59Z") },
    });
  }

  if (conditions.length === 0) return null;

  return { AND: conditions };
}
