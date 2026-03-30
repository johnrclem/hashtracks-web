"use server";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type TimePeriod = "7d" | "30d" | "90d" | "all";

function periodStart(period: TimePeriod): Date | null {
  if (period === "all") return null;
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ── Community Health ──────────────────────────────────────────────────

interface KennelPopularity {
  kennelId: string;
  shortName: string;
  region: string | null;
  attendanceCount: number;
  subscriptionCount: number;
}

interface RegionActivity {
  region: string | null;
  eventCount: number;
  kennelCount: number;
}

interface AttendanceTrend {
  date: string; // YYYY-MM format
  count: number;
}

export interface CommunityHealthMetrics {
  activeKennelsByRegion: RegionActivity[];
  topKennels: KennelPopularity[];
  attendanceTrends: AttendanceTrend[];
  totalActiveKennels: number;
}

export async function getCommunityHealthMetrics(
  period: TimePeriod = "30d",
): Promise<CommunityHealthMetrics> {
  const since = periodStart(period);
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  // Active kennels by region — kennels with events in the period
  const activeKennelsByRegion = await prisma.$queryRaw<RegionActivity[]>`
    SELECT r."name" AS "region",
           COUNT(DISTINCT e."kennelId")::int AS "kennelCount",
           COUNT(e.id)::int AS "eventCount"
    FROM "Event" e
    JOIN "Kennel" k ON k.id = e."kennelId"
    LEFT JOIN "Region" r ON r.id = k."regionId"
    WHERE e.status != 'CANCELLED'
      AND k."isHidden" = false
      ${since ? Prisma.sql`AND e.date >= ${since}` : Prisma.empty}
    GROUP BY r."name"
    ORDER BY "eventCount" DESC
    LIMIT 20
  `;

  // Top kennels by attendance
  const topKennelsRaw = await prisma.$queryRaw<
    { kennelId: string; shortName: string; region: string | null; attendanceCount: number }[]
  >`
    SELECT k.id AS "kennelId",
           k."shortName",
           r."name" AS "region",
           COUNT(a.id)::int AS "attendanceCount"
    FROM "Attendance" a
    JOIN "Event" e ON e.id = a."eventId"
    JOIN "Kennel" k ON k.id = e."kennelId"
    LEFT JOIN "Region" r ON r.id = k."regionId"
    WHERE a.status = 'CONFIRMED'
      ${since ? Prisma.sql`AND a."createdAt" >= ${since}` : Prisma.empty}
    GROUP BY k.id, k."shortName", r."name"
    ORDER BY "attendanceCount" DESC
    LIMIT 20
  `;

  // Subscription counts for top kennels
  const kennelIds = topKennelsRaw.map((k: { kennelId: string }) => k.kennelId);
  const subCounts =
    kennelIds.length > 0
      ? await prisma.userKennel.groupBy({
          by: ["kennelId"],
          where: { kennelId: { in: kennelIds } },
          _count: { kennelId: true },
        })
      : [];

  const subMap = new Map(subCounts.map((s: { kennelId: string; _count: { kennelId: number } }) => [s.kennelId, s._count.kennelId]));
  const topKennels: KennelPopularity[] = topKennelsRaw.map((k: typeof topKennelsRaw[number]) => ({
    ...k,
    subscriptionCount: subMap.get(k.kennelId) ?? 0,
  }));

  // Attendance trends by month
  const attendanceTrends = await prisma.$queryRaw<AttendanceTrend[]>`
    SELECT to_char(a."createdAt", 'YYYY-MM') AS "date",
           COUNT(*)::int AS "count"
    FROM "Attendance" a
    WHERE a.status = 'CONFIRMED'
      ${since ? Prisma.sql`AND a."createdAt" >= ${since}` : Prisma.empty}
    GROUP BY to_char(a."createdAt", 'YYYY-MM')
    ORDER BY "date"
  `;

  const totalActiveKennels = await prisma.kennel.count({
    where: {
      isHidden: false,
      events: {
        some: {
          status: { not: "CANCELLED" },
          ...(since ? { date: { gte: since } } : {}),
        },
      },
    },
  });

  return {
    activeKennelsByRegion,
    topKennels,
    attendanceTrends,
    totalActiveKennels,
  };
}

// ── User Engagement ───────────────────────────────────────────────────

export interface UserEngagementMetrics {
  totalUsers: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  activeUsers30d: number;
  usersWithCheckins: number;
  usersWithoutCheckins: number;
  subscriptionDistribution: { count: number; users: number }[];
  mismanKennelCount: number;
  totalVisibleKennels: number;
}

export async function getUserEngagementMetrics(): Promise<UserEngagementMetrics> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    newUsersThisWeek,
    newUsersThisMonth,
    activeUsers30dResult,
    usersWithCheckins,
    totalVisibleKennels,
    mismanKennelCount,
    subscriptionDist,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId") AS count
      FROM "Attendance"
      WHERE "createdAt" >= ${monthAgo}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId") AS count FROM "Attendance"
    `,
    prisma.kennel.count({ where: { isHidden: false } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "kennelId") AS count
      FROM "UserKennel"
      WHERE role = 'MISMAN'
    `,
    prisma.$queryRaw<{ count: number; users: number }[]>`
      SELECT sub_count::int AS "count", COUNT(*)::int AS "users"
      FROM (
        SELECT "userId", COUNT(*)::int AS sub_count
        FROM "UserKennel"
        GROUP BY "userId"
      ) sub
      GROUP BY sub_count
      ORDER BY sub_count
    `,
  ]);

  const usersWithCheckinsCount = Number(usersWithCheckins[0].count);

  return {
    totalUsers,
    newUsersThisWeek,
    newUsersThisMonth,
    activeUsers30d: Number(activeUsers30dResult[0].count),
    usersWithCheckins: usersWithCheckinsCount,
    usersWithoutCheckins: totalUsers - usersWithCheckinsCount,
    subscriptionDistribution: subscriptionDist,
    mismanKennelCount: Number(mismanKennelCount[0].count),
    totalVisibleKennels,
  };
}

// ── Operational Health ────────────────────────────────────────────────

interface SourceHealthSummary {
  region: string | null;
  healthy: number;
  degraded: number;
  failing: number;
}

interface ScrapeSuccessRate {
  date: string;
  successRate: number;
}

interface StaleSource {
  id: string;
  name: string;
  region: string | null;
  lastSuccess: Date | null;
}

export interface OperationalHealthMetrics {
  sourceHealthByRegion: SourceHealthSummary[];
  scrapeSuccessRates: ScrapeSuccessRate[];
  staleSources: StaleSource[];
  totalEnabledSources: number;
  totalHealthySources: number;
}

export async function getOperationalHealthMetrics(): Promise<OperationalHealthMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [sourceHealthByRegion, scrapeSuccessRates, staleSources, totalEnabledSources, totalHealthySources] =
    await Promise.all([
      prisma.$queryRaw<SourceHealthSummary[]>`
        SELECT r."name" AS "region",
               SUM(CASE WHEN s."healthStatus" = 'HEALTHY' THEN 1 ELSE 0 END)::int AS "healthy",
               SUM(CASE WHEN s."healthStatus" = 'DEGRADED' THEN 1 ELSE 0 END)::int AS "degraded",
               SUM(CASE WHEN s."healthStatus" IN ('FAILING', 'STALE') THEN 1 ELSE 0 END)::int AS "failing"
        FROM "Source" s
        LEFT JOIN "SourceKennel" sk ON sk."sourceId" = s.id
        LEFT JOIN "Kennel" k ON k.id = sk."kennelId"
        LEFT JOIN "Region" r ON r.id = k."regionId"
        WHERE s.enabled = true
        GROUP BY r."name"
        ORDER BY ("healthy" + "degraded" + "failing") DESC
      `,
      prisma.$queryRaw<ScrapeSuccessRate[]>`
        SELECT to_char(sl."startedAt", 'YYYY-MM-DD') AS "date",
               ROUND(
                 SUM(CASE WHEN sl.status = 'SUCCESS' THEN 1 ELSE 0 END)::numeric /
                 NULLIF(COUNT(*)::numeric, 0) * 100,
                 1
               )::float AS "successRate"
        FROM "ScrapeLog" sl
        WHERE sl."startedAt" >= ${sevenDaysAgo}
        GROUP BY to_char(sl."startedAt", 'YYYY-MM-DD')
        ORDER BY "date"
      `,
      prisma.$queryRaw<StaleSource[]>`
        SELECT s.id, s.name, r."name" AS "region",
               MAX(sl."completedAt") AS "lastSuccess"
        FROM "Source" s
        LEFT JOIN "ScrapeLog" sl ON sl."sourceId" = s.id AND sl.status = 'SUCCESS'
        LEFT JOIN "SourceKennel" sk ON sk."sourceId" = s.id
        LEFT JOIN "Kennel" k ON k.id = sk."kennelId"
        LEFT JOIN "Region" r ON r.id = k."regionId"
        WHERE s.enabled = true
        GROUP BY s.id, s.name, r."name"
        HAVING MAX(sl."completedAt") < ${sevenDaysAgo}
           OR MAX(sl."completedAt") IS NULL
        ORDER BY MAX(sl."completedAt") NULLS FIRST
        LIMIT 20
      `,
      prisma.source.count({ where: { enabled: true } }),
      prisma.source.count({ where: { enabled: true, healthStatus: "HEALTHY" } }),
    ]);

  return {
    sourceHealthByRegion,
    scrapeSuccessRates,
    staleSources,
    totalEnabledSources,
    totalHealthySources,
  };
}
