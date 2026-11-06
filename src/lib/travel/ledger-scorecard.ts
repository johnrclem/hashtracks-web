/**
 * Pure scorecard helpers for the Travel Mode prediction ledger.
 *
 * Shared by `scripts/score-prediction-ledger.ts` (CLI markdown report) and the
 * `/admin/predictions` dashboard so both compute forward calibration IDENTICALLY from
 * `PredictionSnapshot` rows. Precision = HIT / (HIT + MISS) per confidence × actual-days-out
 * bin; PRECONFIRMED + UNOBSERVED are excluded (contamination / unobserved — not model signal).
 * Recall is a deferred follow-up (needs matured cohorts; computed from events, not snapshot rows).
 */
import type { PredictionOutcome, ScheduleConfidence } from "@/generated/prisma/client";

/** Nominal snapshot horizon bands (days out), farthest first. Shared with the ledger job. */
export const LEDGER_BANDS = [180, 90, 30] as const;

/** Actual-days-out bins for precision (report by real horizon, not the nominal band). */
export const DAYSOUT_BINS: { label: string; lo: number; hi: number }[] = [
  { label: "0–45", lo: 0, hi: 45 },
  { label: "46–120", lo: 46, hi: 120 },
  { label: "121–200", lo: 121, hi: 200 },
];

/** The days-out bin label a snapshot falls into (or "200+" beyond the named bins). */
export function binOf(daysOut: number): string {
  return DAYSOUT_BINS.find((b) => daysOut >= b.lo && daysOut <= b.hi)?.label ?? "200+";
}

/** Minimal snapshot shape the precision map needs. */
export interface ScorecardSnap {
  confidence: ScheduleConfidence; // HIGH | MEDIUM in practice (LOW is never snapshotted)
  daysOutAtSnapshot: number;
  outcome: PredictionOutcome;
}

export type PrecisionCell = { hit: number; miss: number };

/** Precision cells keyed `${confidence}|${bin}`, over HIT/MISS rows only. */
export function buildPrecisionMap(snaps: ScorecardSnap[]): Map<string, PrecisionCell> {
  const precision = new Map<string, PrecisionCell>();
  for (const s of snaps) {
    if (s.outcome !== "HIT" && s.outcome !== "MISS") continue;
    const key = `${s.confidence}|${binOf(s.daysOutAtSnapshot)}`;
    const cell = precision.get(key) ?? { hit: 0, miss: 0 };
    if (s.outcome === "HIT") cell.hit++;
    else cell.miss++;
    precision.set(key, cell);
  }
  return precision;
}

export type OutcomeTally = Record<PredictionOutcome, number> & { total: number };

/** Count snapshots per outcome (+ total). */
export function tallyOutcomes(snaps: { outcome: PredictionOutcome }[]): OutcomeTally {
  const t: OutcomeTally = { PENDING: 0, HIT: 0, MISS: 0, PRECONFIRMED: 0, UNOBSERVED: 0, total: 0 };
  for (const s of snaps) {
    t[s.outcome]++;
    t.total++;
  }
  return t;
}

/**
 * Earliest PENDING predictedDate = when the first scores arrive. `reduce` (not `Math.min(...)`)
 * because the pending set can grow large and the spread would risk a max-call-stack overflow.
 */
export function firstMaturityDate(snaps: { outcome: PredictionOutcome; predictedDate: Date }[]): Date | null {
  return snaps.reduce<Date | null>((earliest, s) => {
    if (s.outcome !== "PENDING") return earliest;
    return !earliest || s.predictedDate < earliest ? s.predictedDate : earliest;
  }, null);
}

// ── Lead time (C3): how early a HIT was predicted vs when the run first appeared ─────────────

/** One (confidence × horizon band) lead-time row, aggregated in the DB. */
export interface LeadTimeRow {
  confidence: "HIGH" | "MEDIUM";
  horizon: number;
  /** Scored HITs counted (kennel had an independent source before the snapshot). */
  hits: number;
  /** HITs left out because the kennel's first independent source came after the snapshot. */
  excluded: number;
  /** Median days between the snapshot and the run's first appearance (capped at the run date). */
  medianLeadDays: number | null;
  /** Median days the kennel's own posting preceded the run (0 when posted after the fact). */
  medianPostedAheadDays: number | null;
  /** HITs predicted strictly before any source posted the run. */
  predictedFirst: number;
}

// ── UNOBSERVED per kennel (C4) ──────────────────────────────────────────────────────────────

export interface UnobservedKennelRow {
  kennelCode: string;
  shortName: string;
  region: string;
  unobserved: number;
  /** UNOBSERVED rows whose snapshot had NO independent source frozen (STATIC_SCHEDULE-only / sourceless). */
  noSourceAtSnapshot: number;
  hit: number;
  miss: number;
  /** Enabled non-STATIC_SCHEDULE sources linked to the kennel today. */
  independentSourcesNow: number;
}

export type UnobservedReason = "no-source" | "source-added" | "source-silent";

/**
 * Why a kennel's predictions can't be scored:
 *  - `no-source`: it never had an independent source (nothing can confirm or refute a run);
 *  - `source-added`: it had none at snapshot time but has one now (future snapshots will score);
 *  - `source-silent`: a source existed but posted nothing within ±14 days (dormant kennel or gap).
 */
export function unobservedReason(row: UnobservedKennelRow): UnobservedReason {
  if (row.noSourceAtSnapshot >= row.unobserved) {
    return row.independentSourcesNow > 0 ? "source-added" : "no-source";
  }
  return "source-silent";
}
