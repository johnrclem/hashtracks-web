"use server";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { KNOWN_AUDIT_RULES, type AuditFinding } from "@/pipeline/audit-checks";

/** All audit dashboard actions are admin-only — server actions are POST endpoints anyone can hit. */
async function requireAdmin(): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");
}

/** Encoding used for both DB suppression rows and finding lookup keys. */
function suppressionKey(kennelCode: string | null, rule: string): string {
  return `${kennelCode ?? ""}::${rule}`;
}

const TZ = "America/New_York";
const TREND_DAYS = 30;
const OFFENDER_DAYS = 14; // TODO(phase3): move to materialized aggregate when deep-dive runs land
const RECENT_RUNS_DAYS = 14;
const TOP_OFFENDERS_LIMIT = 20;

/** Bucket a date into `YYYY-MM-DD` in America/New_York. */
function easternDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// ── Trends ──────────────────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  hares: number;
  title: number;
  location: number;
  event: number;
  description: number;
  total: number;
}

export async function getAuditTrends(days = TREND_DAYS): Promise<TrendPoint[]> {
  await requireAdmin();
  const rows = await prisma.auditLog.findMany({
    where: { type: "HARELINE", createdAt: { gte: daysAgo(days) } },
    select: { createdAt: true, summary: true },
    orderBy: { createdAt: "asc" },
  });

  const byDate = new Map<string, TrendPoint>();
  for (const r of rows) {
    const date = easternDate(r.createdAt);
    const summary = (r.summary ?? {}) as Record<string, number>;
    const point = byDate.get(date) ?? {
      date,
      hares: 0,
      title: 0,
      location: 0,
      event: 0,
      description: 0,
      total: 0,
    };
    point.hares += summary.hares ?? 0;
    point.title += summary.title ?? 0;
    point.location += summary.location ?? 0;
    point.event += summary.event ?? 0;
    point.description += summary.description ?? 0;
    point.total = point.hares + point.title + point.location + point.event + point.description;
    byDate.set(date, point);
  }
  return [...byDate.values()];
}

// ── Top Offenders ────────────────────────────────────────────────────

export interface TopOffender {
  kennelCode: string;
  kennelShortName: string;
  rule: string;
  category: string;
  count: number;
  lastSeen: string;
  suppressed: boolean;
}

export async function getTopOffenders(days = OFFENDER_DAYS): Promise<TopOffender[]> {
  await requireAdmin();
  // Rows are ordered desc, so the first encounter for a (kennelCode, rule) key is the most
  // recent date — used for `lastSeen` below. `count` is per-finding occurrence across runs,
  // which inflates for events that persist day-to-day; that's intentional for ranking impact.
  const [rows, suppressions] = await Promise.all([
    prisma.auditLog.findMany({
      where: { type: "HARELINE", createdAt: { gte: daysAgo(days) } },
      select: { createdAt: true, findings: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditSuppression.findMany({ select: { kennelCode: true, rule: true } }),
  ]);

  const suppressedKeys = new Set(suppressions.map(s => suppressionKey(s.kennelCode, s.rule)));

  const map = new Map<string, TopOffender>();
  for (const r of rows) {
    const findings = (r.findings ?? []) as unknown as AuditFinding[];
    for (const f of findings) {
      const key = suppressionKey(f.kennelCode, f.rule);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          kennelCode: f.kennelCode,
          kennelShortName: f.kennelShortName,
          rule: f.rule,
          category: f.category,
          count: 1,
          lastSeen: easternDate(r.createdAt),
          suppressed: suppressedKeys.has(key) || suppressedKeys.has(suppressionKey(null, f.rule)),
        });
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_OFFENDERS_LIMIT);
}

// ── Recent Runs ──────────────────────────────────────────────────────

export interface RecentRun {
  id: string;
  createdAt: Date;
  type: string;
  eventsScanned: number;
  findingsCount: number;
  groupsCount: number;
  issuesFiled: number;
}

export async function getRecentRuns(days = RECENT_RUNS_DAYS): Promise<RecentRun[]> {
  await requireAdmin();
  return prisma.auditLog.findMany({
    where: { type: "HARELINE", createdAt: { gte: daysAgo(days) } },
    select: {
      id: true,
      createdAt: true,
      type: true,
      eventsScanned: true,
      findingsCount: true,
      groupsCount: true,
      issuesFiled: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

// ── Suppressions ─────────────────────────────────────────────────────

export interface SuppressionRow {
  id: string;
  kennelCode: string | null;
  kennelShortName: string | null;
  rule: string;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
}

export async function getSuppressions(): Promise<SuppressionRow[]> {
  await requireAdmin();
  const rows = await prisma.auditSuppression.findMany({
    select: {
      id: true,
      kennelCode: true,
      rule: true,
      reason: true,
      createdBy: true,
      createdAt: true,
      kennel: { select: { shortName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(r => ({
    id: r.id,
    kennelCode: r.kennelCode,
    kennelShortName: r.kennel?.shortName ?? null,
    rule: r.rule,
    reason: r.reason,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}

export async function createSuppression(input: {
  kennelCode: string | null;
  rule: string;
  reason: string;
}): Promise<SuppressionRow> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");

  if (!(KNOWN_AUDIT_RULES as readonly string[]).includes(input.rule)) {
    throw new Error(`Unknown audit rule: ${input.rule}`);
  }
  if (input.reason.trim().length < 10) {
    throw new Error("Reason must be at least 10 characters");
  }

  let created;
  try {
    created = await prisma.auditSuppression.create({
      data: {
        kennelCode: input.kennelCode,
        rule: input.rule,
        reason: input.reason.trim(),
        createdBy: admin.email ?? admin.id,
      },
      select: {
        id: true,
        kennelCode: true,
        rule: true,
        reason: true,
        createdBy: true,
        createdAt: true,
        kennel: { select: { shortName: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error("A suppression for this kennel and rule already exists");
    }
    throw err;
  }
  return {
    id: created.id,
    kennelCode: created.kennelCode,
    kennelShortName: created.kennel?.shortName ?? null,
    rule: created.rule,
    reason: created.reason,
    createdBy: created.createdBy,
    createdAt: created.createdAt,
  };
}

export async function deleteSuppression(id: string): Promise<void> {
  await requireAdmin();
  // deleteMany is idempotent — tolerates double-clicks and already-removed rows.
  await prisma.auditSuppression.deleteMany({ where: { id } });
}

// TODO(phase3): replace JSON-blob scan with materialized aggregate (same target as getTopOffenders).
export async function getSuppressionImpact(
  kennelCode: string | null,
  rule: string,
): Promise<{ totalFindings: number; perDay: number }> {
  await requireAdmin();
  const rows = await prisma.auditLog.findMany({
    where: { type: "HARELINE", createdAt: { gte: daysAgo(OFFENDER_DAYS) } },
    select: { findings: true },
  });
  let total = 0;
  for (const r of rows) {
    const findings = (r.findings ?? []) as unknown as AuditFinding[];
    for (const f of findings) {
      if (f.rule !== rule) continue;
      if (kennelCode === null || f.kennelCode === kennelCode) total += 1;
    }
  }
  return { totalFindings: total, perDay: Math.round((total / OFFENDER_DAYS) * 10) / 10 };
}

// ── Deep Dive ────────────────────────────────────────────────────────

const ACTIVE_EVENT_WINDOW_DAYS = 90;

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

/** Active kennels ranked oldest-deep-dive-first (nulls first). Active = ≥1 source + ≥1 event in last 90d. */
export async function getDeepDiveQueue(limit = 20): Promise<DeepDiveCandidate[]> {
  await requireAdmin();

  const activeSince = daysAgo(ACTIVE_EVENT_WINDOW_DAYS);

  const [kennels, lastDives] = await Promise.all([
    prisma.kennel.findMany({
      where: {
        isHidden: false,
        sourceKennels: { some: { source: { enabled: true } } },
        events: { some: { date: { gte: activeSince } } },
      },
      select: {
        kennelCode: true,
        shortName: true,
        slug: true,
        region: true,
        sourceKennels: {
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
    sources: k.sourceKennels.map(sk => ({
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

export async function getNextDeepDiveKennel(): Promise<DeepDiveCandidate | null> {
  const queue = await getDeepDiveQueue(1);
  return queue[0] ?? null;
}

export interface DeepDiveCoverage {
  audited: number;
  total: number;
  percent: number;
  projectedFullCycleDate: string | null;
}

/** Counts how many active kennels have at least one deep dive on record. */
export async function getDeepDiveCoverage(): Promise<DeepDiveCoverage> {
  await requireAdmin();
  const activeSince = daysAgo(ACTIVE_EVENT_WINDOW_DAYS);

  const [total, dived] = await Promise.all([
    prisma.kennel.count({
      where: {
        isHidden: false,
        sourceKennels: { some: { source: { enabled: true } } },
        events: { some: { date: { gte: activeSince } } },
      },
    }),
    prisma.auditLog.groupBy({
      by: ["kennelCode"],
      where: { type: "KENNEL_DEEP_DIVE", kennelCode: { not: null } },
    }),
  ]);

  const audited = dived.length;
  const percent = total > 0 ? Math.round((audited / total) * 100) : 0;
  const remaining = Math.max(0, total - audited);
  const projectedDate =
    remaining > 0
      ? new Date(Date.now() + remaining * 86_400_000).toISOString().split("T")[0]
      : null;

  return { audited, total, percent, projectedFullCycleDate: projectedDate };
}

/** Record that a deep dive has been completed for a kennel. */
export async function recordDeepDive(input: {
  kennelCode: string;
  findingsCount: number;
  summary: string;
}): Promise<{ id: string }> {
  await requireAdmin();
  if (!input.kennelCode) throw new Error("kennelCode is required");
  if (input.findingsCount < 0) throw new Error("findingsCount must be ≥ 0");

  const log = await prisma.auditLog.create({
    data: {
      type: "KENNEL_DEEP_DIVE",
      kennelCode: input.kennelCode,
      eventsScanned: 0,
      findingsCount: input.findingsCount,
      groupsCount: 0,
      issuesFiled: input.findingsCount,
      findings: [],
      summary: { note: input.summary },
    },
    select: { id: true },
  });
  return log;
}
