/**
 * Read-only data loaders for /admin/predictions.
 *
 * These are PLAIN async functions (NOT `"use server"` actions) imported only by the
 * admin-gated server component page — so they are never exposed as POST endpoints. The only
 * `"use server"` entry point is the admin-guarded recompute in `actions.ts`. (Server actions
 * are POST endpoints anyone can hit; read paths stay off that surface — Codex review.)
 */
import { prisma } from "@/lib/db";
import type { DriftFinding } from "@/pipeline/rule-drift";
import type { PredictionOutcome, ScheduleConfidence } from "@/generated/prisma/client";
import {
  DAYSOUT_BINS,
  binOf,
  type LeadTimeRow,
  type OutcomeTally,
  type UnobservedKennelRow,
} from "@/lib/travel/ledger-scorecard";

// ── Ledger scorecard ────────────────────────────────────────────────────────
export interface PrecisionCellView {
  confidence: "HIGH" | "MEDIUM";
  bin: string;
  hit: number;
  miss: number;
  /** HIT / (HIT + MISS); null when no scored rows in the cell ("not matured", not zero). */
  precision: number | null;
}

export interface LedgerScorecard {
  total: number;
  outcomes: OutcomeTally;
  scored: number; // HIT + MISS
  precision: PrecisionCellView[]; // full HIGH/MEDIUM × bin grid (for the heatmap)
  firstMaturityISO: string | null;
  firstSnapshotISO: string | null;
  kennelsCovered: number;
  confidenceSplit: { HIGH: number; MEDIUM: number };
  weekly: { week: string; count: number }[]; // accumulation by snapshot week-start
}

/** UTC date (YYYY-MM-DD) of the Monday that starts `d`'s week. */
function weekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon = 0
  date.setUTCDate(date.getUTCDate() - dayNum);
  return date.toISOString().slice(0, 10);
}

// — groupBy result processors (kept out of the loader to bound its cognitive complexity) —
type OutcomeGroup = { outcome: PredictionOutcome; _count: number };
type PrecisionGroup = { confidence: ScheduleConfidence; daysOutAtSnapshot: number; outcome: PredictionOutcome; _count: number };
type ConfidenceGroup = { confidence: ScheduleConfidence; _count: number };
type WeeklyGroup = { snapshotAt: Date; _count: number };

function tallyOutcomeGroups(groups: OutcomeGroup[]): OutcomeTally {
  const t: OutcomeTally = { PENDING: 0, HIT: 0, MISS: 0, PRECONFIRMED: 0, UNOBSERVED: 0, total: 0 };
  for (const g of groups) {
    t[g.outcome] = g._count;
    t.total += g._count;
  }
  return t;
}

function precisionFromGroups(groups: PrecisionGroup[]): PrecisionCellView[] {
  const map = new Map<string, { hit: number; miss: number }>();
  for (const g of groups) {
    if (g.confidence !== "HIGH" && g.confidence !== "MEDIUM") continue;
    const cell = map.get(`${g.confidence}|${binOf(g.daysOutAtSnapshot)}`) ?? { hit: 0, miss: 0 };
    if (g.outcome === "HIT") cell.hit += g._count;
    else cell.miss += g._count;
    map.set(`${g.confidence}|${binOf(g.daysOutAtSnapshot)}`, cell);
  }
  const out: PrecisionCellView[] = [];
  for (const confidence of ["HIGH", "MEDIUM"] as const) {
    for (const b of DAYSOUT_BINS) {
      const cell = map.get(`${confidence}|${b.label}`) ?? { hit: 0, miss: 0 };
      const scored = cell.hit + cell.miss;
      out.push({ confidence, bin: b.label, hit: cell.hit, miss: cell.miss, precision: scored > 0 ? cell.hit / scored : null });
    }
  }
  return out;
}

function splitConfidence(groups: ConfidenceGroup[]): { HIGH: number; MEDIUM: number } {
  const split = { HIGH: 0, MEDIUM: 0 };
  for (const g of groups) {
    if (g.confidence === "HIGH" || g.confidence === "MEDIUM") split[g.confidence] = g._count;
  }
  return split;
}

function bucketWeekly(groups: WeeklyGroup[]): { week: string; count: number }[] {
  const weekCounts = new Map<string, number>();
  for (const g of groups) {
    const w = weekStart(g.snapshotAt);
    weekCounts.set(w, (weekCounts.get(w) ?? 0) + g._count);
  }
  return [...weekCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, count]) => ({ week, count }));
}

export async function loadLedgerScorecard(): Promise<LedgerScorecard> {
  // Aggregate in the DB (not by fetching every row) — PredictionSnapshot grows ~weekly forever,
  // so an in-memory tally would balloon and risk OOM in serverless (gemini review). The grouped
  // results are bounded: outcomes (≤5), precision by confidence×daysOut×outcome (≤~800),
  // confidence (≤3), and snapshots-by-snapshotAt (≈1 row per weekly cron run via createMany).
  const [outcomeGroups, precisionGroups, earliestPending, earliestSnapshot, confidenceGroups, weeklyGroups, distinctKennels] =
    await Promise.all([
      prisma.predictionSnapshot.groupBy({ by: ["outcome"], _count: true }),
      prisma.predictionSnapshot.groupBy({
        by: ["confidence", "daysOutAtSnapshot", "outcome"],
        where: { outcome: { in: ["HIT", "MISS"] } },
        _count: true,
      }),
      prisma.predictionSnapshot.aggregate({ where: { outcome: "PENDING" }, _min: { predictedDate: true } }),
      prisma.predictionSnapshot.aggregate({ _min: { snapshotAt: true } }),
      prisma.predictionSnapshot.groupBy({ by: ["confidence"], _count: true }),
      prisma.predictionSnapshot.groupBy({ by: ["snapshotAt"], _count: true }),
      prisma.predictionSnapshot.findMany({ select: { kennelId: true }, distinct: ["kennelId"] }),
    ]);

  const outcomes = tallyOutcomeGroups(outcomeGroups);
  return {
    total: outcomes.total,
    outcomes,
    scored: outcomes.HIT + outcomes.MISS,
    precision: precisionFromGroups(precisionGroups),
    firstMaturityISO: earliestPending._min.predictedDate?.toISOString() ?? null,
    firstSnapshotISO: earliestSnapshot._min.snapshotAt?.toISOString() ?? null,
    kennelsCovered: distinctKennels.length,
    confidenceSplit: splitConfidence(confidenceGroups),
    weekly: bucketWeekly(weeklyGroups),
  };
}

// ── Lead time: predicted N days before the run first appeared (C3) ─────────
export interface LeadTimeView {
  rows: LeadTimeRow[]; // HIGH then MEDIUM, nearest horizon first; only combinations with HITs
  totalExcluded: number;
}

/**
 * Median lead time of HITs per confidence × horizon band, aggregated in the DB (bounded output).
 *
 * "Appeared" = the matched event's `createdAt`, capped at the run date: a run first ingested
 * AFTER it happened (backfill, archive page, late onboarding) never counts as more advance
 * notice than the run itself. HITs at kennels whose first independent source was created
 * after the snapshot are excluded — onboarding would otherwise inflate the lead.
 */
export async function loadLeadTime(): Promise<LeadTimeView> {
  const rows = await prisma.$queryRaw<LeadTimeRow[]>`
    WITH first_src AS (
      SELECT sk."kennelId", MIN(s."createdAt") AS first_at
      FROM "SourceKennel" sk JOIN "Source" s ON s.id = sk."sourceId"
      WHERE s.type <> 'STATIC_SCHEDULE'
      GROUP BY sk."kennelId"
    ),
    hits AS (
      SELECT ps.confidence::text AS confidence, ps."horizonBucket" AS horizon,
        EXTRACT(EPOCH FROM (LEAST(e."createdAt", e.date) - ps."snapshotAt")) / 86400.0 AS lead_days,
        EXTRACT(EPOCH FROM (e.date - e."createdAt")) / 86400.0 AS posted_ahead_days,
        (f.first_at IS NOT NULL AND f.first_at <= ps."snapshotAt") AS eligible
      FROM "PredictionSnapshot" ps
      JOIN "Event" e ON e.id = ps."matchedEventId"
      LEFT JOIN first_src f ON f."kennelId" = ps."kennelId"
      WHERE ps.outcome = 'HIT'
    )
    SELECT confidence, horizon,
      (COUNT(*) FILTER (WHERE eligible))::int AS "hits",
      (COUNT(*) FILTER (WHERE NOT eligible))::int AS "excluded",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY lead_days) FILTER (WHERE eligible) AS "medianLeadDays",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(posted_ahead_days, 0)) FILTER (WHERE eligible) AS "medianPostedAheadDays",
      (COUNT(*) FILTER (WHERE eligible AND lead_days > 0))::int AS "predictedFirst"
    FROM hits
    GROUP BY confidence, horizon
    ORDER BY confidence, horizon`;
  return {
    rows: rows.filter((r) => r.hits > 0),
    totalExcluded: rows.reduce((sum, r) => sum + r.excluded, 0),
  };
}

// ── UNOBSERVED per kennel (C4) ──────────────────────────────────────────────
export interface UnobservedView {
  kennels: UnobservedKennelRow[]; // top UNOBSERVED_LIMIT by count
  kennelCount: number; // all kennels with ≥1 UNOBSERVED snapshot
  totalUnobserved: number;
}

const UNOBSERVED_LIMIT = 40;

/** Kennels whose matured predictions could not be scored, with whether they have an independent source. */
export async function loadUnobservedByKennel(): Promise<UnobservedView> {
  const rows = await prisma.$queryRaw<(UnobservedKennelRow & { kennelCount: number; totalUnobserved: number })[]>`
    WITH indep AS (
      SELECT sk."kennelId", (COUNT(*) FILTER (WHERE s.enabled))::int AS enabled_sources
      FROM "SourceKennel" sk JOIN "Source" s ON s.id = sk."sourceId"
      WHERE s.type <> 'STATIC_SCHEDULE'
      GROUP BY sk."kennelId"
    )
    SELECT k."kennelCode" AS "kennelCode", k."shortName" AS "shortName", k.region AS "region",
      (COUNT(*) FILTER (WHERE ps.outcome = 'UNOBSERVED'))::int AS "unobserved",
      (COUNT(*) FILTER (WHERE ps.outcome = 'UNOBSERVED' AND cardinality(ps."independentSourceIds") = 0))::int AS "noSourceAtSnapshot",
      (COUNT(*) FILTER (WHERE ps.outcome = 'HIT'))::int AS "hit",
      (COUNT(*) FILTER (WHERE ps.outcome = 'MISS'))::int AS "miss",
      COALESCE(MAX(i.enabled_sources), 0)::int AS "independentSourcesNow",
      (COUNT(*) OVER ())::int AS "kennelCount",
      (SUM(COUNT(*) FILTER (WHERE ps.outcome = 'UNOBSERVED')) OVER ())::int AS "totalUnobserved"
    FROM "PredictionSnapshot" ps
    JOIN "Kennel" k ON k.id = ps."kennelId"
    LEFT JOIN indep i ON i."kennelId" = ps."kennelId"
    WHERE ps.outcome IN ('UNOBSERVED', 'HIT', 'MISS')
    GROUP BY k.id
    HAVING COUNT(*) FILTER (WHERE ps.outcome = 'UNOBSERVED') > 0
    ORDER BY "unobserved" DESC, k."kennelCode"
    LIMIT ${UNOBSERVED_LIMIT}`;
  return {
    kennels: rows.map(({ kennelCount: _kc, totalUnobserved: _tu, ...k }) => k),
    kennelCount: rows[0]?.kennelCount ?? 0,
    totalUnobserved: rows[0]?.totalUnobserved ?? 0,
  };
}

// ── Rule-drift (latest persisted snapshot) ──────────────────────────────────
export interface RuleDriftView {
  ranAtISO: string | null;
  findings: DriftFinding[];
  everRun: boolean;
}

/** The findings JSON column is `DriftFinding[]`; guard against a non-array value defensively. */
function asFindings(json: unknown): DriftFinding[] {
  return Array.isArray(json) ? (json as DriftFinding[]) : [];
}

export async function loadRuleDriftSnapshot(): Promise<RuleDriftView> {
  const latest = await prisma.ruleDriftSnapshot.findFirst({ orderBy: { ranAt: "desc" } });
  if (!latest) return { ranAtISO: null, findings: [], everRun: false };
  return {
    ranAtISO: latest.ranAt.toISOString(),
    findings: asFindings(latest.findings),
    everRun: true,
  };
}

// ── Schedule-rule coverage ──────────────────────────────────────────────────
export interface RuleCoverage {
  activeRules: number;
  byConfidence: { HIGH: number; MEDIUM: number; LOW: number };
  bySource: { source: string; count: number }[];
  kennelsWithRule: number;
  seasonalKennels: number;
  darkKennels: number; // visible kennels with no active rule
  totalVisibleKennels: number;
}

export async function loadRuleCoverage(): Promise<RuleCoverage> {
  const activeVisible = { isActive: true, kennel: { isHidden: false } } as const;
  const [byConf, bySrc, activeRules, withRule, seasonal, totalVisibleKennels] = await Promise.all([
    prisma.scheduleRule.groupBy({ by: ["confidence"], where: activeVisible, _count: true }),
    prisma.scheduleRule.groupBy({ by: ["source"], where: activeVisible, _count: true }),
    prisma.scheduleRule.count({ where: activeVisible }),
    prisma.scheduleRule.findMany({ where: activeVisible, select: { kennelId: true }, distinct: ["kennelId"] }),
    prisma.scheduleRule.findMany({
      where: { ...activeVisible, OR: [{ validFrom: { not: null } }, { validUntil: { not: null } }] },
      select: { kennelId: true },
      distinct: ["kennelId"],
    }),
    prisma.kennel.count({ where: { isHidden: false } }),
  ]);

  const byConfidence = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const r of byConf) byConfidence[r.confidence] = r._count;
  const bySource = bySrc.map((r) => ({ source: r.source, count: r._count })).sort((a, b) => b.count - a.count);
  const kennelsWithRule = withRule.length;

  return {
    activeRules,
    byConfidence,
    bySource,
    kennelsWithRule,
    seasonalKennels: seasonal.length,
    darkKennels: Math.max(0, totalVisibleKennels - kennelsWithRule),
    totalVisibleKennels,
  };
}
