"use server";

import { getMismanUser, getRosterGroupId, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  computeSuggestionScores,
  LOOKBACK_DAYS,
  type SuggestionScore,
} from "@/lib/misman/suggestions";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Validate that the event belongs to a kennel in the roster scope
 * and is within the 1-year lookback window.
 */
async function validateEventForAttendance(
  eventId: string,
  kennelId: string,
): Promise<{ error?: string; event?: { id: string; kennelId: string } }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, kennelId: true, date: true },
  });
  if (!event) return { error: "Event not found" };

  const rosterKennelIds = await getRosterKennelIds(kennelId);
  if (!rosterKennelIds.includes(event.kennelId)) {
    return { error: "Event does not belong to this kennel or roster group" };
  }

  const oneYearAgo = new Date(Date.now() - ONE_YEAR_MS);
  if (event.date < oneYearAgo) {
    return { error: "Cannot record attendance for events older than 1 year" };
  }

  return { event };
}

/**
 * Record attendance for a hasher at an event.
 * Uses upsert so duplicate adds are safe (idempotent).
 */
export async function recordAttendance(
  kennelId: string,
  eventId: string,
  kennelHasherId: string,
  data?: {
    paid?: boolean;
    haredThisTrail?: boolean;
    isVirgin?: boolean;
    isVisitor?: boolean;
    visitorLocation?: string;
    referralSource?: string;
    referralOther?: string;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const validation = await validateEventForAttendance(eventId, kennelId);
  if (validation.error) return { error: validation.error };

  // Verify the hasher is in the roster scope
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: kennelHasherId },
    select: { rosterGroupId: true },
  });
  if (!hasher) return { error: "Hasher not found" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  if (hasher.rosterGroupId !== rosterGroupId) {
    return { error: "Hasher is not in this kennel's roster scope" };
  }

  await prisma.kennelAttendance.upsert({
    where: {
      kennelHasherId_eventId: { kennelHasherId, eventId },
    },
    update: {
      paid: data?.paid ?? false,
      haredThisTrail: data?.haredThisTrail ?? false,
      isVirgin: data?.isVirgin ?? false,
      isVisitor: data?.isVisitor ?? false,
      visitorLocation: data?.isVisitor ? (data?.visitorLocation?.trim() || null) : null,
      referralSource: (data?.isVirgin || data?.isVisitor) ? (data?.referralSource as never) ?? null : null,
      referralOther: data?.referralSource === "OTHER" ? (data?.referralOther?.trim() || null) : null,
      recordedBy: user.id,
    },
    create: {
      kennelHasherId,
      eventId,
      paid: data?.paid ?? false,
      haredThisTrail: data?.haredThisTrail ?? false,
      isVirgin: data?.isVirgin ?? false,
      isVisitor: data?.isVisitor ?? false,
      visitorLocation: data?.isVisitor ? (data?.visitorLocation?.trim() || null) : null,
      referralSource: (data?.isVirgin || data?.isVisitor) ? (data?.referralSource as never) ?? null : null,
      referralOther: data?.referralSource === "OTHER" ? (data?.referralOther?.trim() || null) : null,
      recordedBy: user.id,
    },
  });

  return { success: true };
}

/**
 * Remove a single attendance record.
 */
export async function removeAttendance(kennelId: string, attendanceId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const record = await prisma.kennelAttendance.findUnique({
    where: { id: attendanceId },
  });
  if (!record) return { error: "Attendance record not found" };

  await prisma.kennelAttendance.delete({ where: { id: attendanceId } });

  return { success: true };
}

/**
 * Update specific fields on an attendance record.
 */
export async function updateAttendance(
  kennelId: string,
  attendanceId: string,
  data: {
    paid?: boolean;
    haredThisTrail?: boolean;
    isVirgin?: boolean;
    isVisitor?: boolean;
    visitorLocation?: string;
    referralSource?: string;
    referralOther?: string;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const record = await prisma.kennelAttendance.findUnique({
    where: { id: attendanceId },
  });
  if (!record) return { error: "Attendance record not found" };

  const updateData: Record<string, unknown> = {};

  if (data.paid !== undefined) updateData.paid = data.paid;
  if (data.haredThisTrail !== undefined) updateData.haredThisTrail = data.haredThisTrail;
  if (data.isVirgin !== undefined) updateData.isVirgin = data.isVirgin;
  if (data.isVisitor !== undefined) {
    updateData.isVisitor = data.isVisitor;
    if (!data.isVisitor) {
      updateData.visitorLocation = null;
    }
  }
  if (data.visitorLocation !== undefined) {
    updateData.visitorLocation = data.visitorLocation?.trim() || null;
  }
  if (data.referralSource !== undefined) {
    updateData.referralSource = data.referralSource || null;
    if (data.referralSource !== "OTHER") {
      updateData.referralOther = null;
    }
  }
  if (data.referralOther !== undefined) {
    updateData.referralOther = data.referralOther?.trim() || null;
  }

  await prisma.kennelAttendance.update({
    where: { id: attendanceId },
    data: updateData,
  });

  return { success: true };
}

/**
 * Clear all attendance records for an event. Returns count for confirmation.
 */
export async function clearEventAttendance(kennelId: string, eventId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const result = await prisma.kennelAttendance.deleteMany({
    where: { eventId },
  });

  return { success: true, deleted: result.count };
}

/**
 * Get current attendance for an event (used for polling).
 */
export async function getEventAttendance(kennelId: string, eventId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const records = await prisma.kennelAttendance.findMany({
    where: { eventId },
    include: {
      kennelHasher: {
        select: {
          id: true,
          hashName: true,
          nerdName: true,
          kennelId: true,
        },
      },
      recordedByUser: {
        select: { hashName: true, email: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    data: records.map((r) => ({
      id: r.id,
      kennelHasherId: r.kennelHasherId,
      hashName: r.kennelHasher.hashName,
      nerdName: r.kennelHasher.nerdName,
      paid: r.paid,
      haredThisTrail: r.haredThisTrail,
      isVirgin: r.isVirgin,
      isVisitor: r.isVisitor,
      visitorLocation: r.visitorLocation,
      referralSource: r.referralSource,
      referralOther: r.referralOther,
      recordedBy: r.recordedByUser.hashName || r.recordedByUser.email,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Quick-add: create a new hasher on the roster AND record attendance in one step.
 */
export async function quickAddHasher(
  kennelId: string,
  eventId: string,
  data: {
    hashName?: string;
    nerdName?: string;
    paid?: boolean;
    haredThisTrail?: boolean;
    isVirgin?: boolean;
    isVisitor?: boolean;
    visitorLocation?: string;
    referralSource?: string;
    referralOther?: string;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const hashName = data.hashName?.trim() || null;
  const nerdName = data.nerdName?.trim() || null;

  if (!hashName && !nerdName) {
    return { error: "Either hash name or nerd name is required" };
  }

  const validation = await validateEventForAttendance(eventId, kennelId);
  if (validation.error) return { error: validation.error };

  // Create hasher
  const rosterGroupId = await getRosterGroupId(kennelId);
  const hasher = await prisma.kennelHasher.create({
    data: {
      rosterGroupId,
      kennelId,
      hashName,
      nerdName,
    },
  });

  // Record attendance
  await prisma.kennelAttendance.create({
    data: {
      kennelHasherId: hasher.id,
      eventId,
      paid: data.paid ?? false,
      haredThisTrail: data.haredThisTrail ?? false,
      isVirgin: data.isVirgin ?? false,
      isVisitor: data.isVisitor ?? false,
      visitorLocation: data.isVisitor ? (data.visitorLocation?.trim() || null) : null,
      referralSource: (data.isVirgin || data.isVisitor) ? (data.referralSource as never) ?? null : null,
      referralOther: data.referralSource === "OTHER" ? (data.referralOther?.trim() || null) : null,
      recordedBy: user.id,
    },
  });

  return { success: true, hasherId: hasher.id };
}

/**
 * Get suggestion scores for hashers most likely to attend.
 * Uses weighted algorithm: 50% frequency + 30% recency + 20% streak.
 */
export async function getSuggestions(kennelId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const rosterKennelIds = await getRosterKennelIds(kennelId);
  const lookbackDate = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  // Fetch kennel events (this kennel only, within lookback)
  const kennelEvents = await prisma.event.findMany({
    where: { kennelId, date: { gte: lookbackDate } },
    select: { id: true, date: true },
    orderBy: { date: "desc" },
  });

  // Fetch all attendance in roster scope (within lookback)
  // Events belong to kennels, so we still use getRosterKennelIds here
  const attendanceRecords = await prisma.kennelAttendance.findMany({
    where: {
      event: {
        kennelId: { in: rosterKennelIds },
        date: { gte: lookbackDate },
      },
    },
    select: {
      kennelHasherId: true,
      eventId: true,
      event: { select: { date: true, kennelId: true } },
    },
  });

  // Fetch all hasher IDs in roster scope (via rosterGroupId)
  const hashers = await prisma.kennelHasher.findMany({
    where: { rosterGroupId },
    select: { id: true, hashName: true, nerdName: true },
  });

  const eventKennelMap = new Map<string, string>();
  for (const e of kennelEvents) eventKennelMap.set(e.id, kennelId);
  for (const r of attendanceRecords) {
    eventKennelMap.set(r.eventId, r.event.kennelId);
  }

  const scores = computeSuggestionScores({
    kennelId,
    rosterKennelIds,
    kennelEvents,
    attendanceRecords: attendanceRecords.map((r) => ({
      kennelHasherId: r.kennelHasherId,
      eventId: r.eventId,
      eventDate: r.event.date,
    })),
    rosterHasherIds: hashers.map((h) => h.id),
    eventKennelMap,
  });

  // Enrich with hasher names
  const hasherMap = new Map(hashers.map((h) => [h.id, h]));
  const enriched = scores.map((s) => {
    const hasher = hasherMap.get(s.kennelHasherId);
    return {
      ...s,
      hashName: hasher?.hashName ?? null,
      nerdName: hasher?.nerdName ?? null,
    };
  });

  return { data: enriched };
}
