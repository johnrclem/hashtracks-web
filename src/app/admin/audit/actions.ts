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
