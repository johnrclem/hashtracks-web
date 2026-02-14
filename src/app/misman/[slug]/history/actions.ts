"use server";

import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Get attendance history for a kennel (expanded to roster group scope).
 * Returns per-event attendance summaries, most recent first.
 */
export async function getAttendanceHistory(
  kennelId: string,
  filters?: {
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 25;
  const skip = (page - 1) * pageSize;

  const dateFilter: Record<string, unknown> = {};
  if (filters?.startDate) {
    dateFilter.gte = new Date(filters.startDate);
  }
  if (filters?.endDate) {
    dateFilter.lte = new Date(filters.endDate);
  }

  const where = {
    kennelAttendances: { some: {} },
    kennelId,
    ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
  };

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        kennel: { select: { shortName: true } },
        kennelAttendances: {
          include: {
            kennelHasher: {
              select: { hashName: true, nerdName: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { date: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.event.count({ where }),
  ]);

  return {
    data: events.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      title: e.title,
      runNumber: e.runNumber,
      kennelShortName: e.kennel.shortName,
      attendeeCount: e.kennelAttendances.length,
      paidCount: e.kennelAttendances.filter((a) => a.paid).length,
      hareCount: e.kennelAttendances.filter((a) => a.haredThisTrail).length,
      virginCount: e.kennelAttendances.filter((a) => a.isVirgin).length,
      visitorCount: e.kennelAttendances.filter((a) => a.isVisitor).length,
      attendees: e.kennelAttendances.map((a) => ({
        id: a.id,
        hashName: a.kennelHasher.hashName,
        nerdName: a.kennelHasher.nerdName,
        paid: a.paid,
        haredThisTrail: a.haredThisTrail,
        isVirgin: a.isVirgin,
        isVisitor: a.isVisitor,
      })),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get detailed stats and attendance history for a single hasher.
 */
export async function getHasherDetail(kennelId: string, hasherId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterKennelIds = await getRosterKennelIds(kennelId);

  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: hasherId },
    include: {
      kennel: { select: { shortName: true } },
      userLink: {
        include: {
          user: { select: { hashName: true, email: true } },
        },
      },
      attendances: {
        include: {
          event: {
            select: {
              id: true,
              date: true,
              title: true,
              runNumber: true,
              kennelId: true,
              kennel: { select: { shortName: true } },
            },
          },
        },
        orderBy: { event: { date: "desc" } },
      },
    },
  });

  if (!hasher) return { error: "Hasher not found" };
  if (!rosterKennelIds.includes(hasher.kennelId)) {
    return { error: "Hasher is not in this kennel's roster scope" };
  }

  // Compute stats
  const attendances = hasher.attendances;
  const totalRuns = attendances.length;
  const hareCount = attendances.filter((a) => a.haredThisTrail).length;
  const paidCount = attendances.filter((a) => a.paid).length;

  // First and last attendance dates
  const firstRun = attendances.length > 0
    ? attendances[attendances.length - 1].event.date
    : null;
  const lastRun = attendances.length > 0
    ? attendances[0].event.date
    : null;

  return {
    data: {
      id: hasher.id,
      kennelId: hasher.kennelId,
      kennelShortName: hasher.kennel.shortName,
      hashName: hasher.hashName,
      nerdName: hasher.nerdName,
      email: hasher.email,
      phone: hasher.phone,
      notes: hasher.notes,
      createdAt: hasher.createdAt.toISOString(),
      userLink: hasher.userLink
        ? {
            status: hasher.userLink.status,
            userHashName: hasher.userLink.user.hashName,
            userEmail: hasher.userLink.user.email,
          }
        : null,
      stats: {
        totalRuns,
        hareCount,
        paidCount,
        firstRun: firstRun?.toISOString() ?? null,
        lastRun: lastRun?.toISOString() ?? null,
      },
      attendances: attendances.map((a) => ({
        id: a.id,
        eventId: a.event.id,
        date: a.event.date.toISOString(),
        title: a.event.title,
        runNumber: a.event.runNumber,
        kennelShortName: a.event.kennel.shortName,
        paid: a.paid,
        haredThisTrail: a.haredThisTrail,
        isVirgin: a.isVirgin,
        isVisitor: a.isVisitor,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };
}

/** Placeholder patterns to skip when parsing hare names */
const HARE_IGNORE_PATTERNS = [
  /^n\/?a$/i,
  /^tbd$/i,
  /^tba$/i,
  /sign up/i,
  /^-+$/,
  /^\?+$/,
  /^unknown$/i,
  /^none$/i,
];

/**
 * Split a haresText string into individual hare names.
 * Handles comma, ampersand, and "and" delimiters.
 */
function splitHareNames(haresText: string): string[] {
  const parts = haresText.split(",");
  const names: string[] = [];

  for (const part of parts) {
    const subParts = part
      .split(/\s+&\s+/i)
      .flatMap((s) => s.split(/\s+and\s+/i));

    for (const name of subParts) {
      const trimmed = name.replace(/\s+/g, " ").trim();
      if (!trimmed) continue;
      if (HARE_IGNORE_PATTERNS.some((p) => p.test(trimmed))) continue;
      names.push(trimmed);
    }
  }

  return names;
}

/**
 * Seed the roster from Event.haresText data.
 * Queries events in the roster scope (last year), parses comma-separated
 * hare names, deduplicates against existing roster, creates new KennelHasher entries.
 */
export async function seedRosterFromHares(kennelId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterKennelIds = await getRosterKennelIds(kennelId);
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  // Get all events with hare data in the roster scope (last year)
  const events = await prisma.event.findMany({
    where: {
      kennelId: { in: rosterKennelIds },
      date: { gte: oneYearAgo },
      haresText: { not: null },
    },
    select: { haresText: true },
  });

  // Parse and deduplicate hare names (case-insensitive)
  const uniqueNames = new Map<string, string>();
  for (const e of events) {
    if (!e.haresText) continue;
    const names = splitHareNames(e.haresText);
    for (const name of names) {
      const key = name.toLowerCase();
      if (!uniqueNames.has(key)) {
        uniqueNames.set(key, name);
      }
    }
  }

  // Get existing roster entries for fuzzy dedup
  const existing = await prisma.kennelHasher.findMany({
    where: { kennelId: { in: rosterKennelIds } },
    select: { hashName: true, nerdName: true },
  });

  const existingNames = new Set<string>();
  for (const e of existing) {
    if (e.hashName) existingNames.add(e.hashName.toLowerCase());
    if (e.nerdName) existingNames.add(e.nerdName.toLowerCase());
  }

  // Filter out names that already exist in the roster
  const newNames: string[] = [];
  for (const [key, name] of uniqueNames) {
    if (!existingNames.has(key)) {
      newNames.push(name);
    }
  }

  if (newNames.length === 0) {
    return { success: true, created: 0, message: "All hare names already exist in the roster" };
  }

  // Create new KennelHasher entries
  const created = await prisma.kennelHasher.createMany({
    data: newNames.map((name) => ({
      kennelId,
      hashName: name,
    })),
  });

  return {
    success: true,
    created: created.count,
    message: `Added ${created.count} hasher(s) from hare data`,
  };
}
