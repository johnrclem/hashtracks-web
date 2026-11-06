/**
 * Deep-dive rotation queue: active kennels ranked never-dived first, then
 * oldest deep dive first.
 *
 * This module has no auth check. Callers gate it themselves:
 * - `getDeepDiveQueue` (admin server action): `requireAdmin()`
 * - `/api/audit/agent/next-deep-dive`: `AUDIT_AGENT_TOKEN`
 * Keep it out of any `"use server"` module so it never becomes a callable
 * endpoint on its own.
 */
import { prisma } from "@/lib/db";
import { daysAgo } from "./audit-dates";

/** "Active" = at least one enabled source and one event in this window. */
export const ACTIVE_EVENT_WINDOW_DAYS = 90;

export interface DeepDiveSource {
  type: string;
  url: string;
  name: string;
}

export interface DeepDiveCandidate {
  kennelCode: string;
  shortName: string;
  slug: string;
  region: string;
  lastDeepDiveAt: Date | null;
  eventCount90d: number;
  sources: DeepDiveSource[];
}

/** Load the queue without an auth check (see module comment). */
export async function loadDeepDiveQueue(limit: number): Promise<DeepDiveCandidate[]> {
  const activeSince = daysAgo(ACTIVE_EVENT_WINDOW_DAYS);

  const [kennels, lastDives] = await Promise.all([
    prisma.kennel.findMany({
      where: {
        isHidden: false,
        sources: { some: { source: { enabled: true } } },
        events: { some: { date: { gte: activeSince } } },
      },
      select: {
        kennelCode: true,
        shortName: true,
        slug: true,
        region: true,
        sources: {
          where: { source: { enabled: true } },
          select: {
            source: { select: { type: true, url: true, name: true } },
          },
        },
        _count: { select: { events: { where: { date: { gte: activeSince } } } } },
      },
    }),
    prisma.auditLog.groupBy({
      by: ["kennelCode"],
      where: { type: "KENNEL_DEEP_DIVE", kennelCode: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const lastDiveByKennel = new Map<string, Date>();
  for (const row of lastDives) {
    if (row.kennelCode && row._max.createdAt) {
      lastDiveByKennel.set(row.kennelCode, row._max.createdAt);
    }
  }

  const candidates: DeepDiveCandidate[] = kennels.map(k => ({
    kennelCode: k.kennelCode,
    shortName: k.shortName,
    slug: k.slug,
    region: k.region,
    lastDeepDiveAt: lastDiveByKennel.get(k.kennelCode) ?? null,
    eventCount90d: k._count.events,
    sources: k.sources.map(sk => ({
      type: sk.source.type,
      url: sk.source.url,
      name: sk.source.name,
    })),
  }));

  // Sort: never-dived first, then oldest dive first
  candidates.sort((a, b) => {
    if (a.lastDeepDiveAt === null && b.lastDeepDiveAt === null) {
      return a.shortName.localeCompare(b.shortName);
    }
    if (a.lastDeepDiveAt === null) return -1;
    if (b.lastDeepDiveAt === null) return 1;
    return a.lastDeepDiveAt.getTime() - b.lastDeepDiveAt.getTime();
  });

  return candidates.slice(0, limit);
}
