/**
 * Prospective prediction ledger (Travel Mode evaluation, Phase 2).
 *
 * Weekly job that:
 *  1. SCORES matured snapshots — once a predicted date passes, check it against
 *     INDEPENDENT (non-STATIC_SCHEDULE) reality: HIT / MISS / UNOBSERVED, with
 *     already-confirmed rows finalized as PRECONFIRMED (contamination, excluded).
 *  2. SNAPSHOTS current predictions — freezes the engine's forward HIGH/MEDIUM
 *     projections at narrow 180/90/30-day bands (resilient to a missed run), storing
 *     the ACTUAL days-out so calibration is reported by real horizon, not the band.
 *  3. Writes the OBSERVATION census — one row per observable rule-bearing kennel per
 *     band per cohort week, INDEPENDENT of whether the model predicted anything, so
 *     recall has a population that includes never-predicted kennels (Codex review #2154).
 *
 * Reuses the REAL engine (projectTrails/scoreConfidence) and isEligibleActual so the
 * ledger measures exactly what production would have predicted.
 */
import type { PrismaClient, Prisma, ScheduleConfidence } from "@/generated/prisma/client";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import { EVENT_ELIGIBILITY_SELECT, isEligibleActual } from "@/lib/event-eligibility";
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

/** Monday 00:00 UTC of the week containing `d` — the stable cohort key. */
export function weekStartUtc(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = (day + 6) % 7; // days since Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
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

export type Outcome = "PENDING" | "HIT" | "MISS" | "PRECONFIRMED" | "UNOBSERVED";

/**
 * Classify a matured snapshot. `confirmedAtSnapshot` short-circuits to PRECONFIRMED
 * (contamination). Otherwise observability is decided from the immutable Event history
 * (±OBSERVE_TOL): no eligible event nearby → UNOBSERVED; else HIT within ±MATCH_TOL,
 * else MISS (observed-but-absent).
 */
export function classifyOutcome(
  predictedDate: Date,
  confirmedAtSnapshot: boolean,
  eligibleEvents: { id: string; date: Date }[],
): { outcome: Exclude<Outcome, "PENDING">; matchedEventId: string | null } {
  if (confirmedAtSnapshot) return { outcome: "PRECONFIRMED", matchedEventId: null };
  const t = predictedDate.getTime();
  let observed = false;
  let hit: string | null = null;
  for (const e of eligibleEvents) {
    const diff = Math.abs(e.date.getTime() - t) / DAY_MS;
    if (diff <= OBSERVE_TOL_DAYS) observed = true;
    if (diff <= MATCH_TOL_DAYS && hit === null) hit = e.id;
  }
  if (hit !== null) return { outcome: "HIT", matchedEventId: hit };
  if (!observed) return { outcome: "UNOBSERVED", matchedEventId: null };
  return { outcome: "MISS", matchedEventId: null };
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
interface EvDate {
  id: string;
  date: Date;
  eligible: boolean;
}

export interface LedgerRunResult {
  scored: number;
  outcomes: Record<Exclude<Outcome, "PENDING">, number>;
  snapshotsCreated: number;
  observationsCreated: number;
  lastSuccessfulRunAt: Date | null;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
export async function runPredictionLedger(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<LedgerRunResult> {
  const loadStart = new Date(now.getTime() - (SNAPSHOT_HORIZON_DAYS + 30) * DAY_MS);
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
      select: { id: true, kennelId: true, date: true, eventKennels: { select: { kennelId: true } }, ...EVENT_ELIGIBILITY_SELECT },
    }),
    prisma.sourceKennel.findMany({
      where: { source: { type: { not: STATIC } } },
      select: { kennelId: true, sourceId: true },
    }),
    prisma.predictionSnapshot.findFirst({ orderBy: { snapshotAt: "desc" }, select: { snapshotAt: true } }),
  ]);

  const lastSuccessfulRunAt = lastSnap?.snapshotAt ?? null;

  // Index events by participating kennel.
  const eventsByKennel = new Map<string, EvDate[]>();
  for (const e of events) {
    const eligible = isEligibleActual(e);
    const ev: EvDate = { id: e.id, date: e.date, eligible };
    const kids = new Set<string>([e.kennelId, ...e.eventKennels.map((ek) => ek.kennelId)]);
    for (const kid of kids) {
      const arr = eventsByKennel.get(kid) ?? [];
      arr.push(ev);
      eventsByKennel.set(kid, arr);
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
    observationsCreated: 0,
    lastSuccessfulRunAt,
  };

  // ── Pass 1: score matured snapshots ────────────────────────────────────────
  const matured = await prisma.predictionSnapshot.findMany({
    where: { outcome: "PENDING", predictedDate: { lt: new Date(now.getTime() - MATURITY_LAG_DAYS * DAY_MS) } },
    select: { id: true, kennelId: true, predictedDate: true, confirmedAtSnapshot: true },
  });
  for (const snap of matured) {
    const eligible = (eventsByKennel.get(snap.kennelId) ?? []).filter((e) => e.eligible);
    const { outcome, matchedEventId } = classifyOutcome(snap.predictedDate, snap.confirmedAtSnapshot, eligible);
    await prisma.predictionSnapshot.update({
      where: { id: snap.id },
      data: { outcome, matchedEventId, matchToleranceDays: MATCH_TOL_DAYS, scoredAt: now },
    });
    result.scored++;
    result.outcomes[outcome]++;
  }

  // ── Pass 2 + 3: snapshot predictions + observation census ──────────────────
  const snapshotRows: Prisma.PredictionSnapshotCreateManyInput[] = [];
  const observationRows: Prisma.LedgerObservationCreateManyInput[] = [];
  const cohortWeek = weekStartUtc(now);
  const windowEnd = new Date(now.getTime() + SNAPSHOT_HORIZON_DAYS * DAY_MS);

  for (const k of kennels) {
    const kRules = rulesByKennel.get(k.id) ?? [];
    if (kRules.length === 0) continue;
    const indepSources = indepSourcesByKennel.get(k.id) ?? [];
    const kEvents = eventsByKennel.get(k.id) ?? [];
    const eligible = kEvents.filter((e) => e.eligible);

    // Observation census: rule-bearing AND observable (has an independent source).
    if (indepSources.length > 0) {
      for (const band of LEDGER_BANDS) {
        observationRows.push({
          kennelId: k.id, horizonBucket: band, cohortWeek,
          daysOutAtSnapshot: band, independentSourceIds: indepSources, hadRuleAtSnapshot: true,
        });
      }
    }

    // Score projections as-of now.
    const ruleInputs: ScheduleRuleInput[] = kRules.map((r) => ({
      id: r.id, kennelId: r.kennelId, rrule: r.rrule, anchorDate: r.anchorDate,
      startTime: r.startTime, confidence: r.confidence, notes: r.notes,
      label: r.label, validFrom: r.validFrom, validUntil: r.validUntil,
    }));
    const projections = projectTrails(ruleInputs, now, windowEnd);
    const evidenceCount = eligible.filter(
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
      // confirmed-at-snapshot uses the SAME ±tol as scoring (contamination gate).
      let preexistingEventId: string | null = null;
      for (const e of eligible) {
        if (Math.abs(e.date.getTime() - proj.date.getTime()) / DAY_MS <= MATCH_TOL_DAYS) { preexistingEventId = e.id; break; }
      }
      for (const band of LEDGER_BANDS) {
        if (!shouldCaptureBand(nowDaysOut, prevDaysOut, band)) continue;
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
  }

  // Idempotent inserts — unique constraints make re-runs within a cohort no-ops.
  if (snapshotRows.length > 0) {
    const r = await prisma.predictionSnapshot.createMany({ data: snapshotRows, skipDuplicates: true });
    result.snapshotsCreated = r.count;
  }
  if (observationRows.length > 0) {
    const r = await prisma.ledgerObservation.createMany({ data: observationRows, skipDuplicates: true });
    result.observationsCreated = r.count;
  }

  return result;
}
