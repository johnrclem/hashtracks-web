/**
 * Prospective prediction ledger (Travel Mode evaluation, Phase 2).
 *
 * Weekly job that:
 *  1. SCORES matured snapshots — once a predicted date passes, check it against the
 *     snapshot's FROZEN independent sources: HIT / MISS / UNOBSERVED, with already-on-books
 *     rows finalized as PRECONFIRMED (contamination, excluded from metrics).
 *  2. SNAPSHOTS current predictions — freezes the engine's forward HIGH/MEDIUM projections
 *     at narrow 180/90/30-day bands (resilient to a missed run), storing the ACTUAL days-out
 *     so calibration is reported by real horizon, not the nominal band.
 *
 * Recall is computed at report time (scripts/score-prediction-ledger.ts) from actual events
 * vs snapshot coverage — a never-predicted kennel's real run is in the events with no covering
 * snapshot → false negative — so no separate observation census is needed.
 *
 * Reuses the REAL engine (projectTrails/scoreConfidence) so the ledger measures exactly what
 * production would have predicted.
 */
import type { PrismaClient, Prisma, ScheduleConfidence } from "@/generated/prisma/client";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import {
  projectTrails,
  scoreConfidence,
  type ScheduleRuleInput,
  type KennelContext,
} from "@/lib/travel/projections";

// ── Tunables ────────────────────────────────────────────────────────────────
export const LEDGER_BANDS = [180, 90, 30] as const;
/** Capture window half-width around each band target. ≥ weekly cron step (7d). */
export const BAND_HALF_WIDTH = 4;
/** A prediction HITs if an eligible event lands within ±this of the predicted date. */
export const MATCH_TOL_DAYS = 1;
/** A matured date is OBSERVED if an eligible event exists within ±this of it. */
export const OBSERVE_TOL_DAYS = 14;
const EVIDENCE_WINDOW_DAYS = 84;
const SNAPSHOT_HORIZON_DAYS = 200;
const MATURITY_LAG_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATIC = "STATIC_SCHEDULE";

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

/** UTC calendar-midnight epoch ms — normalizes away time-of-day so day math is exact. */
function utcMidnightMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole CALENDAR days from→to (UTC), robust to non-noon event/run timestamps. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcMidnightMs(to) - utcMidnightMs(from)) / DAY_MS);
}

/**
 * Whether a predicted date should be captured into `band` on this run. Two paths:
 *  (a) normal: the date is currently within ±halfWidth of the band target;
 *  (b) missed-run recovery: the date SKIPPED that window between the last successful
 *      run and now (a cron was missed), so capture it anyway at its current days-out.
 * `prevDaysOut` is null on the first ever run (no prior snapshot) → only (a) applies.
 */
export function shouldCaptureBand(
  nowDaysOut: number,
  prevDaysOut: number | null,
  band: number,
  halfWidth = BAND_HALF_WIDTH,
): boolean {
  if (nowDaysOut >= band - halfWidth && nowDaysOut <= band + halfWidth) return true;
  if (prevDaysOut !== null && prevDaysOut > band + halfWidth && nowDaysOut < band - halfWidth) {
    return true; // date jumped over the window during a missed-run gap
  }
  return false;
}

/**
 * The single band a projection is captured into this run, or null. Normally a descending
 * date is near exactly one band. After a LONG outage `shouldCaptureBand` is true for several
 * bands at once (prev=190, now=20 → 180/90/30) — capturing all of them would fabricate
 * multiple prospective observations from one late model state and triple-count it in the
 * scorecard's actual-days-out bin (Codex review on PR #2164). We capture only the SMALLEST
 * (nearest-crossed) candidate; the stored `daysOutAtSnapshot` reports the honest horizon.
 */
export function captureBandFor(nowDaysOut: number, prevDaysOut: number | null): number | null {
  let chosen: number | null = null;
  for (const band of LEDGER_BANDS) {
    if (shouldCaptureBand(nowDaysOut, prevDaysOut, band) && (chosen === null || band < chosen)) {
      chosen = band;
    }
  }
  return chosen;
}

export type Outcome = "PENDING" | "HIT" | "MISS" | "PRECONFIRMED" | "UNOBSERVED";

/** An event with the Source ids of its independent (non-STATIC_SCHEDULE) RawEvents. */
export interface ScorableEvent {
  id: string;
  date: Date;
  sourceIds: string[];
}

/**
 * Classify a matured snapshot. `confirmedAtSnapshot` short-circuits to PRECONFIRMED
 * (contamination). Otherwise observability is decided from events restricted to the
 * snapshot's FROZEN independent sources — a source added/removed after capture must not
 * retroactively change an old outcome (Codex review on PR #2164). No frozen-source event
 * within ±OBSERVE_TOL → UNOBSERVED; else HIT within ±MATCH_TOL, else MISS.
 */
export function classifyOutcome(
  predictedDate: Date,
  confirmedAtSnapshot: boolean,
  events: ScorableEvent[],
  frozenSourceIds: ReadonlySet<string>,
): { outcome: Exclude<Outcome, "PENDING">; matchedEventId: string | null } {
  if (confirmedAtSnapshot) return { outcome: "PRECONFIRMED", matchedEventId: null };
  const t = utcMidnightMs(predictedDate);
  let observed = false;
  let hit: string | null = null;
  for (const e of events) {
    if (!e.sourceIds.some((sid) => frozenSourceIds.has(sid))) continue; // frozen-provenance gate
    const diff = Math.abs(utcMidnightMs(e.date) - t) / DAY_MS;
    if (diff <= OBSERVE_TOL_DAYS) observed = true;
    if (diff <= MATCH_TOL_DAYS && hit === null) hit = e.id;
  }
  if (hit !== null) return { outcome: "HIT", matchedEventId: hit };
  if (!observed) return { outcome: "UNOBSERVED", matchedEventId: null };
  return { outcome: "MISS", matchedEventId: null };
}

/** Identity key matching the PredictionSnapshot unique constraint (for in-batch dedup). */
function snapshotKey(r: { kennelId: string; predictedDate: Date | string; startTimeKey: string; horizonBucket: number }): string {
  const iso = r.predictedDate instanceof Date ? r.predictedDate.toISOString() : new Date(r.predictedDate).toISOString();
  return `${r.kennelId}:${iso.slice(0, 10)}:${r.startTimeKey}:${r.horizonBucket}`;
}

// ── Internal data shapes ──────────────────────────────────────────────────────
interface KennelRow {
  id: string;
  shortName: string;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  lastEventDate: Date | null;
}
interface RuleRow {
  id: string;
  kennelId: string;
  rrule: string;
  anchorDate: string | null;
  startTime: string | null;
  confidence: ScheduleConfidence;
  notes: string | null;
  label: string | null;
  validFrom: string | null;
  validUntil: string | null;
  lastValidatedAt: Date | null;
}

export interface LedgerRunResult {
  scored: number;
  outcomes: Record<Exclude<Outcome, "PENDING">, number>;
  snapshotsCreated: number;
  lastSuccessfulRunAt: Date | null;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
export async function runPredictionLedger(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<LedgerRunResult> {
  // predictedDate is stored at UTC noon; normalize the cutoff to the same convention so a
  // sub-day wall-clock skew can't leave a just-matured snapshot PENDING for a whole extra
  // weekly cycle (CodeRabbit review on PR #2164).
  const nowNoonMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  const maturityCutoff = new Date(nowNoonMs - MATURITY_LAG_DAYS * DAY_MS);

  // Matured snapshots can be arbitrarily old after a long cron outage; the event window
  // must reach back to the OLDEST pending matured target (− observe tol) or scoring would
  // see no events and wrongly mark them UNOBSERVED (Codex review on PR #2164).
  const [oldestPending, matured] = await Promise.all([
    prisma.predictionSnapshot.aggregate({
      where: { outcome: "PENDING", predictedDate: { lt: maturityCutoff } },
      _min: { predictedDate: true },
    }),
    prisma.predictionSnapshot.findMany({
      where: { outcome: "PENDING", predictedDate: { lt: maturityCutoff } },
      select: { id: true, kennelId: true, predictedDate: true, confirmedAtSnapshot: true, independentSourceIds: true },
    }),
  ]);

  const defaultStart = now.getTime() - (SNAPSHOT_HORIZON_DAYS + 30) * DAY_MS;
  const oldestPendingMs = oldestPending._min.predictedDate
    ? oldestPending._min.predictedDate.getTime() - (OBSERVE_TOL_DAYS + 1) * DAY_MS
    : defaultStart;
  const loadStart = new Date(Math.min(defaultStart, oldestPendingMs));
  const loadEnd = new Date(now.getTime() + (SNAPSHOT_HORIZON_DAYS + 10) * DAY_MS);

  const [kennels, rules, events, sourceLinks, lastSnap] = await Promise.all([
    prisma.kennel.findMany({
      where: { isHidden: false },
      select: {
        id: true, shortName: true, scheduleDayOfWeek: true,
        scheduleTime: true, scheduleFrequency: true, lastEventDate: true,
      },
    }) as Promise<KennelRow[]>,
    prisma.scheduleRule.findMany({
      where: { isActive: true, kennel: { isHidden: false } },
      select: {
        id: true, kennelId: true, rrule: true, anchorDate: true, startTime: true,
        confidence: true, notes: true, label: true, validFrom: true, validUntil: true,
        lastValidatedAt: true,
      },
    }) as Promise<RuleRow[]>,
    prisma.event.findMany({
      where: {
        ...CANONICAL_EVENT_WHERE,
        status: "CONFIRMED",
        date: { gte: loadStart, lte: loadEnd },
        kennel: { isHidden: false },
      },
      select: {
        id: true, kennelId: true, date: true,
        eventKennels: { select: { kennelId: true } },
        rawEvents: { select: { source: { select: { id: true, type: true } } } },
      },
    }),
    prisma.sourceKennel.findMany({
      where: { source: { type: { not: STATIC } } },
      select: { kennelId: true, sourceId: true },
    }),
    prisma.predictionSnapshot.findFirst({ orderBy: { snapshotAt: "desc" }, select: { snapshotAt: true } }),
  ]);

  const lastSuccessfulRunAt = lastSnap?.snapshotAt ?? null;

  // Index events by participating kennel, tagged with their INDEPENDENT source ids.
  const eventsByKennel = new Map<string, ScorableEvent[]>();
  for (const e of events) {
    const sourceIds = [...new Set(e.rawEvents.filter((re) => re.source.type !== STATIC).map((re) => re.source.id))];
    if (sourceIds.length === 0) continue; // not independent ground truth
    const ev: ScorableEvent = { id: e.id, date: e.date, sourceIds };
    const kids = new Set<string>([e.kennelId, ...e.eventKennels.map((ek) => ek.kennelId)]);
    for (const kid of kids) {
      const arr = eventsByKennel.get(kid);
      if (arr) arr.push(ev);
      else eventsByKennel.set(kid, [ev]);
    }
  }
  const rulesByKennel = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const arr = rulesByKennel.get(r.kennelId);
    if (arr) arr.push(r);
    else rulesByKennel.set(r.kennelId, [r]);
  }
  const indepSourcesByKennel = new Map<string, string[]>();
  for (const sk of sourceLinks) {
    const arr = indepSourcesByKennel.get(sk.kennelId);
    if (arr) arr.push(sk.sourceId);
    else indepSourcesByKennel.set(sk.kennelId, [sk.sourceId]);
  }

  const result: LedgerRunResult = {
    scored: 0,
    outcomes: { HIT: 0, MISS: 0, PRECONFIRMED: 0, UNOBSERVED: 0 },
    snapshotsCreated: 0,
    lastSuccessfulRunAt,
  };

  // ── Pass 1: score matured snapshots against their FROZEN sources ────────────
  for (const snap of matured) {
    const events = eventsByKennel.get(snap.kennelId) ?? [];
    const frozen = new Set(snap.independentSourceIds);
    const { outcome, matchedEventId } = classifyOutcome(snap.predictedDate, snap.confirmedAtSnapshot, events, frozen);
    await prisma.predictionSnapshot.update({
      where: { id: snap.id },
      data: { outcome, matchedEventId, matchToleranceDays: MATCH_TOL_DAYS, scoredAt: now },
    });
    result.scored++;
    result.outcomes[outcome]++;
  }

  // ── Pass 2: snapshot current predictions ───────────────────────────────────
  const snapshotRows: Prisma.PredictionSnapshotCreateManyInput[] = [];
  const windowEnd = new Date(now.getTime() + SNAPSHOT_HORIZON_DAYS * DAY_MS);

  for (const k of kennels) {
    const kRules = rulesByKennel.get(k.id) ?? [];
    if (kRules.length === 0) continue;
    const indepSources = indepSourcesByKennel.get(k.id) ?? [];
    const indepSet = new Set(indepSources);
    const kEvents = eventsByKennel.get(k.id) ?? [];

    const ruleInputs: ScheduleRuleInput[] = kRules.map((r) => ({
      id: r.id, kennelId: r.kennelId, rrule: r.rrule, anchorDate: r.anchorDate,
      startTime: r.startTime, confidence: r.confidence, notes: r.notes,
      label: r.label, validFrom: r.validFrom, validUntil: r.validUntil,
    }));
    const projections = projectTrails(ruleInputs, now, windowEnd);
    const evidenceCount = kEvents.filter(
      (e) => e.date.getTime() >= now.getTime() - EVIDENCE_WINDOW_DAYS * DAY_MS && e.date.getTime() <= now.getTime(),
    ).length;
    const ruleValidation = new Map(kRules.map((r) => [r.id, r.lastValidatedAt]));
    const ctx: KennelContext = {
      id: k.id, shortName: k.shortName, scheduleDayOfWeek: k.scheduleDayOfWeek,
      scheduleTime: k.scheduleTime, scheduleFrequency: k.scheduleFrequency, lastEventDate: k.lastEventDate,
    };

    for (const proj of projections) {
      if (!proj.date) continue; // LOW/possible — not date-scorable
      const confidence = scoreConfidence(proj.confidence, ctx, evidenceCount, ruleValidation.get(proj.scheduleRuleId) ?? null, now.getTime());
      if (confidence !== "high" && confidence !== "medium") continue;
      const nowDaysOut = daysBetween(now, proj.date);
      const prevDaysOut = lastSuccessfulRunAt ? daysBetween(lastSuccessfulRunAt, proj.date) : null;
      const band = captureBandFor(nowDaysOut, prevDaysOut);
      if (band === null) continue;
      // confirmed-at-snapshot: a current independent-source event within ±tol of the date
      // (same gate as scoring, frozen sources = current indep sources at snapshot time).
      const projMidnight = utcMidnightMs(proj.date);
      let preexistingEventId: string | null = null;
      for (const e of kEvents) {
        if (!e.sourceIds.some((sid) => indepSet.has(sid))) continue;
        if (Math.abs(utcMidnightMs(e.date) - projMidnight) / DAY_MS <= MATCH_TOL_DAYS) { preexistingEventId = e.id; break; }
      }
      snapshotRows.push({
        kennelId: k.id,
        scheduleRuleId: proj.scheduleRuleId,
        predictedDate: proj.date,
        startTimeKey: proj.startTime ?? "",
        startTime: proj.startTime,
        confidence: confidence === "high" ? "HIGH" : "MEDIUM",
        horizonBucket: band,
        daysOutAtSnapshot: nowDaysOut,
        confirmedAtSnapshot: preexistingEventId !== null,
        preexistingEventId,
        independentSourceIds: indepSources,
      });
    }
  }

  // Dedup in-batch by the unique identity (two rules projecting the same date+time+band)
  // before createMany — Postgres bulk insert can still error on intra-batch dup keys even
  // with skipDuplicates (Codex review on PR #2164). skipDuplicates then covers existing rows.
  const seen = new Set<string>();
  const deduped = snapshotRows.filter((r) => {
    const key = snapshotKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length > 0) {
    const r = await prisma.predictionSnapshot.createMany({ data: deduped, skipDuplicates: true });
    result.snapshotsCreated = r.count;
  }

  return result;
}
