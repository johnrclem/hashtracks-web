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
import {
  DAYSOUT_BINS,
  buildPrecisionMap,
  tallyOutcomes,
  firstMaturityDate,
  type OutcomeTally,
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

export async function loadLedgerScorecard(): Promise<LedgerScorecard> {
  const snaps = await prisma.predictionSnapshot.findMany({
    select: { confidence: true, daysOutAtSnapshot: true, outcome: true, predictedDate: true, snapshotAt: true, kennelId: true },
  });

  const outcomes = tallyOutcomes(snaps);
  const precisionMap = buildPrecisionMap(snaps);
  const precision: PrecisionCellView[] = [];
  for (const confidence of ["HIGH", "MEDIUM"] as const) {
    for (const b of DAYSOUT_BINS) {
      const cell = precisionMap.get(`${confidence}|${b.label}`) ?? { hit: 0, miss: 0 };
      const scored = cell.hit + cell.miss;
      precision.push({ confidence, bin: b.label, hit: cell.hit, miss: cell.miss, precision: scored > 0 ? cell.hit / scored : null });
    }
  }

  const firstMaturity = firstMaturityDate(snaps);
  const firstSnapshot = snaps.reduce<Date | null>((e, s) => (!e || s.snapshotAt < e ? s.snapshotAt : e), null);
  const confidenceSplit = { HIGH: 0, MEDIUM: 0 };
  const weekCounts = new Map<string, number>();
  for (const s of snaps) {
    if (s.confidence === "HIGH" || s.confidence === "MEDIUM") confidenceSplit[s.confidence]++;
    const w = weekStart(s.snapshotAt);
    weekCounts.set(w, (weekCounts.get(w) ?? 0) + 1);
  }
  const weekly = [...weekCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, count]) => ({ week, count }));

  return {
    total: outcomes.total,
    outcomes,
    scored: outcomes.HIT + outcomes.MISS,
    precision,
    firstMaturityISO: firstMaturity?.toISOString() ?? null,
    firstSnapshotISO: firstSnapshot?.toISOString() ?? null,
    kennelsCovered: new Set(snaps.map((s) => s.kennelId)).size,
    confidenceSplit,
    weekly,
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
