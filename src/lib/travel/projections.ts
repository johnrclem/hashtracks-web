/**
 * Travel Mode Projection Engine
 *
 * Given a set of ScheduleRules and a date window, generates projected trails
 * with confidence scoring and human-readable explanations.
 *
 * Key contract:
 * - HIGH/MEDIUM rules → parseRRule + generateOccurrences → specific dates
 * - LOW rules (CADENCE sentinels, FREQ=LUNAR) → "possible activity" with date=null
 * - The engine NEVER calls parseRRule on LOW-confidence rules
 *
 * Reuses parseRRule() and generateOccurrences() from the STATIC_SCHEDULE adapter
 * for date generation — no new RRULE implementation.
 */

import {
  parseRRule,
  generateOccurrences,
} from "@/adapters/static-schedule/adapter";
import { formatTime } from "@/lib/format";
import type { ScheduleConfidence } from "@/generated/prisma/client";

// ============================================================================
// Types
// ============================================================================

export interface ScheduleRuleInput {
  id: string;
  kennelId: string;
  rrule: string;
  anchorDate: string | null;
  startTime: string | null;
  confidence: ScheduleConfidence;
  notes: string | null;
}

export interface KennelContext {
  id: string;
  shortName: string;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  lastEventDate: Date | null;
}

export interface ConfirmedEventRef {
  kennelId: string;
  date: Date; // UTC noon
  startTime?: string | null;
}

export interface ProjectedTrail {
  kennelId: string;
  date: Date | null;       // UTC noon; null for LOW-confidence "possible activity"
  startTime: string | null;
  confidence: "high" | "medium" | "low";
  scheduleRuleId: string;
  explanation: string;
  evidenceWindow: string;
}

export interface EvidenceTimeline {
  weeks: boolean[];    // 12 entries, true if that week had ≥1 confirmed event
  totalEvents: number;
}

// ============================================================================
// Day name lookups (for human-readable explanations)
// ============================================================================

const RRULE_DAY_TO_NAME: Record<string, string> = {
  SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday",
  TH: "Thursday", FR: "Friday", SA: "Saturday",
};

// "last" is RRULE's special nth value (-1) — handled out-of-band in
// nthLabel() so the lookup table can stay typed as Record<number, string>.
// Previously had `"-1": "last"` as a stringy key, which TS coerced silently
// but failed lookups via numeric index — `NTH_LABELS[-1]` returned undefined.
const NTH_LABELS: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
};

function nthLabel(n: number): string {
  if (n === -1) return "last";
  return NTH_LABELS[n] ?? `${n}th`;
}

// ============================================================================
// Core projection
// ============================================================================

/**
 * Standard "possible activity" projection — used for LOW-confidence rules,
 * unanchored interval rules that drift, and unparseable RRULEs.
 */
function projectAsLowConfidence(rule: ScheduleRuleInput): ProjectedTrail {
  return {
    kennelId: rule.kennelId,
    date: null,
    startTime: rule.startTime,
    confidence: "low",
    scheduleRuleId: rule.id,
    explanation: generateExplanationFromRule(rule),
    evidenceWindow: "",
  };
}

/**
 * Date-specific projection for a HIGH/MEDIUM rule. May still demote to a
 * single low-confidence record if the rule has an interval > 1 without an
 * anchor (drift hazard), or fail back to low if parseRRule throws.
 */
function projectScheduledRule(
  rule: ScheduleRuleInput,
  windowStart: Date,
  windowEnd: Date,
): ProjectedTrail[] {
  try {
    const parsed = parseRRule(rule.rrule!);

    // Interval-based rules without an anchor produce unstable dates that
    // shift with the search window; demote to possible activity. The
    // backfill already filters these, but defense in depth.
    if (parsed.interval > 1 && !rule.anchorDate) {
      return [projectAsLowConfidence(rule)];
    }

    const dateStrings = generateOccurrences(
      parsed,
      windowStart,
      windowEnd,
      rule.anchorDate ?? undefined,
    );
    const explanation = generateExplanationFromRule(rule, parsed);
    const confidence = rule.confidence === "HIGH" ? "high" : "medium";
    const evidenceWindow = rule.confidence === "HIGH"
      ? "Based on a known schedule source"
      : "Based on known schedule pattern";

    return dateStrings.map((dateStr) => ({
      kennelId: rule.kennelId,
      date: new Date(dateStr + "T12:00:00Z"),
      startTime: rule.startTime,
      confidence,
      scheduleRuleId: rule.id,
      explanation,
      evidenceWindow,
    }));
  } catch {
    // Unparseable rrule — surface as possible activity rather than crashing.
    return [projectAsLowConfidence(rule)];
  }
}

/**
 * Generate projected trails from schedule rules for a date window.
 *
 * HIGH/MEDIUM rules produce date-specific projections via the RRULE engine.
 * LOW rules produce a single "possible activity" entry with `date: null`.
 */
export function projectTrails(
  rules: ScheduleRuleInput[],
  windowStart: Date,
  windowEnd: Date,
): ProjectedTrail[] {
  const results: ProjectedTrail[] = [];
  for (const rule of rules) {
    if (!rule.rrule) continue;
    if (rule.confidence === "LOW") {
      results.push(projectAsLowConfidence(rule));
    } else {
      results.push(...projectScheduledRule(rule, windowStart, windowEnd));
    }
  }

  // Deduplicate by (kennelId, date): when multiple rules generate projections
  // for the same kennel on the same date (e.g. STATIC_SCHEDULE + SEED_DATA both
  // produce "Saturday"), keep only the highest-confidence one. This prevents
  // duplicate travel result cards for the same trail.
  const deduped = deduplicateProjectionsByKennelDate(results);

  // Sort: date-specific results first (by date asc), then null-date results
  return deduped.sort((a, b) => {
    if (a.date && b.date) return a.date.getTime() - b.date.getTime();
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return 0;
  });
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * When multiple rules produce projections for the same kennel+date+time, keep
 * only the highest-confidence one. Uses (kennelId, date, startTime) as the dedup
 * key so legitimate same-day double trails (e.g., morning and evening runs) are
 * preserved. Null-date entries (possible activity) are deduped by kennelId alone.
 */
function deduplicateProjectionsByKennelDate(
  projections: ProjectedTrail[],
): ProjectedTrail[] {
  const best = new Map<string, ProjectedTrail>();
  for (const proj of projections) {
    const key = proj.date
      ? `${proj.kennelId}:${proj.date.toISOString().slice(0, 10)}:${proj.startTime ?? ""}`
      : `${proj.kennelId}:__possible__`;
    const existing = best.get(key);
    if (!existing || (CONFIDENCE_RANK[proj.confidence] ?? 0) > (CONFIDENCE_RANK[existing.confidence] ?? 0)) {
      best.set(key, proj);
    }
  }
  return [...best.values()];
}

// ============================================================================
// Confidence scoring
// ============================================================================

/**
 * Refine the base confidence of a projected trail using kennel activity signals.
 *
 * Scoring inputs (per PRD §10.3):
 * - Base confidence from ScheduleRule
 * - Historical consistency: confirmed event count in last 90 days
 * - Kennel activity: lastEventDate recency
 * - Rule validation recency: lastValidatedAt on the rule
 *
 * Returns the final confidence level. Can upgrade MEDIUM→HIGH or degrade
 * MEDIUM→LOW / HIGH→MEDIUM based on evidence.
 */
export function scoreConfidence(
  baseConfidence: "high" | "medium" | "low",
  kennel: KennelContext,
  confirmedEventCount: number,
  lastValidatedAt: Date | null,
): "high" | "medium" | "low" {
  // LOW is terminal — never upgrade possible-activity rules
  if (baseConfidence === "low") return "low";

  const now = Date.now();
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const ONE_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;

  // Explicitly typed to allow degradation to "low" in extreme cases
  let score: "high" | "medium" | "low" = baseConfidence;

  // Boost MEDIUM → HIGH if strong evidence
  if (
    score === "medium" &&
    confirmedEventCount >= 3 &&
    lastValidatedAt &&
    now - lastValidatedAt.getTime() < THIRTY_DAYS_MS
  ) {
    score = "high";
  }

  // Degrade if rule validation is stale
  if (lastValidatedAt && now - lastValidatedAt.getTime() > ONE_EIGHTY_DAYS_MS) {
    if (score === "high") score = "medium";
    // Don't degrade MEDIUM→LOW just for stale validation — it still has a parseable pattern
  }

  // Degrade if kennel appears inactive
  if (kennel.lastEventDate && now - kennel.lastEventDate.getTime() > NINETY_DAYS_MS) {
    if (score === "high") score = "medium";
  }

  // PRD §Confidence Model: Medium requires ≥1 evidence event.
  if (score === "medium" && confirmedEventCount === 0) score = "low";

  return score;
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Remove projected trails where a CONFIRMED event already exists for the
 * same kennel + date (+ startTime when available).
 *
 * Strategy: when BOTH the confirmed event and the projection have a startTime,
 * use (kennelId, date, startTime) so a confirmed afternoon run doesn't suppress
 * a projected evening run. When either side lacks a startTime, fall back to
 * (kennelId, date) — conservative, since we can't distinguish time slots.
 *
 * Only deduplicates against events with status=CONFIRMED (not TENTATIVE).
 */
export function deduplicateAgainstConfirmed(
  projections: ProjectedTrail[],
  confirmedEvents: ConfirmedEventRef[],
): ProjectedTrail[] {
  // Two key sets: one with startTime for precise matching, one date-only for fallback
  const confirmedWithTime = new Set<string>();
  const confirmedDateOnly = new Set<string>();
  for (const evt of confirmedEvents) {
    const dateKey = evt.date.toISOString().slice(0, 10);
    if (evt.startTime) {
      confirmedWithTime.add(`${evt.kennelId}:${dateKey}:${evt.startTime}`);
    } else {
      // No startTime on confirmed event → suppress all projections for this kennel+date
      confirmedDateOnly.add(`${evt.kennelId}:${dateKey}`);
    }
  }

  return projections.filter((proj) => {
    if (!proj.date) return true;
    const dateKey = proj.date.toISOString().slice(0, 10);
    const kennelDate = `${proj.kennelId}:${dateKey}`;

    // If any confirmed event for this kennel+date had no startTime, suppress all
    if (confirmedDateOnly.has(kennelDate)) return false;

    // If projection has a startTime, check for exact match
    if (proj.startTime) {
      return !confirmedWithTime.has(`${kennelDate}:${proj.startTime}`);
    }

    // Projection has no startTime — suppress if any confirmed event exists for this date
    return confirmedWithTime.size === 0 ||
      ![...confirmedWithTime].some((k) => k.startsWith(kennelDate + ":"));
  });
}

// ============================================================================
// Evidence timeline
// ============================================================================

/**
 * Build a 12-week evidence timeline for a kennel, showing which weeks
 * had at least one confirmed event. Used by the EvidenceTimeline UI component.
 *
 * @param events - Confirmed events for this kennel over the last 12 weeks
 *                 (pre-filtered by the caller from a batched query).
 * @param referenceDate - "Now" reference for computing the 12-week window.
 *                        Defaults to Date.now(). Exposed for testing.
 */
export function buildEvidenceTimeline(
  events: { date: Date }[],
  referenceDate: Date = new Date(),
): EvidenceTimeline {
  const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(referenceDate.getTime() - TWELVE_WEEKS_MS);

  const weeks: boolean[] = new Array(12).fill(false);

  let totalEvents = 0;
  for (const evt of events) {
    const eventTime = evt.date.getTime();
    if (eventTime < windowStart.getTime() || eventTime > referenceDate.getTime()) continue;

    totalEvents++;
    // Compute which week bucket this event falls into (0 = oldest, 11 = most recent)
    const msIntoWindow = eventTime - windowStart.getTime();
    const weekIndex = Math.min(11, Math.floor(msIntoWindow / (7 * 24 * 60 * 60 * 1000)));
    weeks[weekIndex] = true;
  }

  return { weeks, totalEvents };
}

// ============================================================================
// Explanation text generation
// ============================================================================

/**
 * Generate a human-readable explanation of why a projected trail is being shown.
 *
 * Examples:
 * - "Usually runs on Saturdays at 7:00 PM"
 * - "Monthly on the 2nd Saturday"
 * - "Biweekly schedule — check closer to your trip"
 * - "Full moon schedule"
 */
/** Format helper: "" or " at 7:30 PM" */
function timeSuffix(startTime: string | null | undefined): string {
  return startTime ? ` at ${formatTime(startTime)}` : "";
}

/** Explanation strings for the non-parseable CADENCE / LUNAR sentinels. */
function explainSentinel(rrule: string, startTime: string | null | undefined): string | null {
  if (rrule === "FREQ=LUNAR") {
    return "Full moon schedule — check kennel sources for exact dates";
  }
  if (rrule.startsWith("CADENCE=BIWEEKLY")) {
    const day = extractDayFromSentinel(rrule);
    const dayName = day ? RRULE_DAY_TO_NAME[day] : null;
    return dayName
      ? `Usually runs on alternating ${dayName}s${timeSuffix(startTime)} — verify closer to your trip`
      : "Alternating schedule — verify closer to your trip";
  }
  if (rrule.startsWith("CADENCE=MONTHLY")) {
    const day = extractDayFromSentinel(rrule);
    const dayName = day ? RRULE_DAY_TO_NAME[day] : null;
    return dayName
      ? `Monthly on a ${dayName}${timeSuffix(startTime)} — specific week unknown`
      : "Monthly schedule — timing varies";
  }
  return null;
}

/** Explanation strings for parsed RRULEs (WEEKLY / MONTHLY-by-day / MONTHLY-by-monthday). */
function explainParsedRRule(parsed: ReturnType<typeof parseRRule>, startTime: string | null | undefined): string | null {
  const ts = timeSuffix(startTime);
  if (parsed.freq === "WEEKLY" && parsed.byDay) {
    const dayStr = dayNumberToName(parsed.byDay.day);
    return parsed.interval > 1
      ? `Usually runs every other ${dayStr}${ts}`
      : `Usually runs on ${dayStr}s${ts}`;
  }
  if (parsed.freq === "MONTHLY" && parsed.byDay) {
    const dayStr = dayNumberToName(parsed.byDay.day);
    return parsed.byDay.nth
      ? `Monthly on the ${nthLabel(parsed.byDay.nth)} ${dayStr}${ts}`
      : `Monthly on a ${dayStr}${ts}`;
  }
  if (parsed.freq === "MONTHLY" && parsed.byMonthDay) {
    return `Monthly on the ${ordinal(parsed.byMonthDay)}${ts}`;
  }
  return null;
}

export function generateExplanationFromRule(
  rule: ScheduleRuleInput,
  // Optional: callers that already parsed the rrule (projectScheduledRule)
  // can pass the result to avoid a second parse. parseRRule is cheap but
  // skipping it is free.
  parsed?: ReturnType<typeof parseRRule>,
): string {
  const { rrule, startTime, notes, confidence } = rule;

  const sentinelExplanation = explainSentinel(rrule, startTime);
  if (sentinelExplanation) return sentinelExplanation;

  try {
    const parsedRRule = parsed ?? parseRRule(rrule);
    const parsedExplanation = explainParsedRRule(parsedRRule, startTime);
    if (parsedExplanation) return parsedExplanation;
  } catch {
    // Falls through to the generic copy below.
  }

  if (confidence === "LOW" && notes) return notes;
  return "Schedule pattern detected — verify closer to your trip";
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract BYDAY token from a CADENCE sentinel like "CADENCE=BIWEEKLY;BYDAY=TH" */
function extractDayFromSentinel(sentinel: string): string | null {
  const match = /BYDAY=([A-Z]{2})/.exec(sentinel);
  return match ? match[1] : null;
}

/** Convert JS Date.getUTCDay() number to day name (Sunday=0). */
function dayNumberToName(dayNum: number): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[dayNum] ?? "day";
}

/** Ordinal suffix: 1st, 2nd, 3rd, 4th, ... */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Projection horizon tiers — how far ahead each confidence level can be
 * reliably projected. Confirmed events ignore these bounds entirely
 * (a real event planned 2 years out is still real).
 */
export const PROJECTION_HORIZON_ALL_DAYS = 180;
export const PROJECTION_HORIZON_HIGH_DAYS = 365;

/**
 * Outer bound for the confirmed-event query. Confirmed events can render
 * past the 365-day projection horizon (a real NYE run 18 months out is
 * still real), but a URL-crafted or saved-trip end-date decades out must
 * not fan out Event.findMany unboundedly. 2 years comfortably covers every
 * realistic trip plan without letting the query walk the full Event table.
 */
export const CONFIRMED_EVENT_HORIZON_DAYS = 730;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which confidence levels can still project at `startDate`. Horizon gates:
 *   0–180d: MEDIUM + HIGH projections + LOW possible (all)
 *   181–365d: HIGH projections + LOW possible (high)
 *   365+d: no projections; confirmed events still render (none)
 */
export type ProjectionHorizonTier = "all" | "high" | "none";

export function projectionHorizonForStart(
  startDate: Date,
  referenceDate: Date = new Date(),
): ProjectionHorizonTier {
  const daysOut = (startDate.getTime() - referenceDate.getTime()) / DAY_MS;
  if (daysOut <= PROJECTION_HORIZON_ALL_DAYS) return "all";
  if (daysOut <= PROJECTION_HORIZON_HIGH_DAYS) return "high";
  return "none";
}

/**
 * Strip projections whose confidence exceeds what's allowed at this tier.
 * LOW-confidence "possible activity" has no date and doesn't decay with
 * distance — it survives every tier. Fast-paths the common `"all"` case
 * to skip allocating a filtered copy.
 */
export function filterProjectionsByHorizon<T extends { confidence: "high" | "medium" | "low" }>(
  projections: T[],
  tier: ProjectionHorizonTier,
): T[] {
  if (tier === "all") return projections;
  if (tier === "high") {
    return projections.filter(p => p.confidence === "high" || p.confidence === "low");
  }
  return projections.filter(p => p.confidence === "low");
}

/**
 * Clamp a date range end to the outer HIGH horizon so projection loops
 * don't run unboundedly on Jan-2028 trips. Confirmed-event queries can
 * bypass this — a real posted event past the horizon is still displayable.
 */
export function clampToProjectionHorizon(
  endDate: Date,
  referenceDate: Date = new Date(),
): Date {
  const horizonRaw = new Date(referenceDate.getTime() + PROJECTION_HORIZON_HIGH_DAYS * DAY_MS);
  const horizon = new Date(Date.UTC(
    horizonRaw.getUTCFullYear(),
    horizonRaw.getUTCMonth(),
    horizonRaw.getUTCDate(),
    12, 0, 0,
  ));
  return endDate.getTime() > horizon.getTime() ? horizon : endDate;
}
