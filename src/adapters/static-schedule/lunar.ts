/**
 * Lunar phase recurrence helpers for the STATIC_SCHEDULE adapter.
 *
 * Two operating modes covered:
 *   - Exact (no anchor): event lands on the calendar date of the astronomical
 *     phase in the kennel's timezone (e.g. FMH3 SF on the full moon).
 *   - Anchor: event lands on the nearest matching weekday relative to the phase
 *     date (e.g. DCFMH3 — "Fri/Sat near full moon").
 *
 * No network I/O. SunCalc computes the moon phase locally from astronomical
 * tables (~10KB, MIT, no deps). USNO/FarmSense alternatives are not used to
 * avoid rate-limit risk and an external dependency.
 *
 * See `lunar.test.ts` for behavioral specification.
 */

import SunCalc from "suncalc";
import { WEEKDAY_NAMES } from "../utils";
import { toIsoDateString, parseUtcNoonDate } from "@/lib/date";
import { formatYmdInTimezone } from "@/lib/timezone";

/**
 * Configuration for a lunar STATIC_SCHEDULE source. Either `rrule` OR `lunar`
 * is required on the parent `StaticScheduleConfig` — never both. XOR enforced
 * by `validateStaticScheduleConfig` and the adapter's `fetch()`.
 */
export interface LunarConfig {
  /** Which lunar phase the kennel runs on. */
  phase: "full" | "new";
  /**
   * IANA timezone the kennel operates in (e.g. "America/Los_Angeles"). The
   * astronomical phase instant is converted to a calendar date in this zone
   * — a full moon at 03:00 UTC is the previous day in Honolulu but the same
   * day in London. Required because the adapter is pure: it doesn't look up
   * the kennel's region. The admin UI defaults this from the kennel's region
   * timezone; seed rows include it explicitly for transparency.
   */
  timezone: string;
  /**
   * Optional: instead of the exact phase date, snap to the nearest day
   * matching this weekday. Two-letter RRULE-style code (SU/MO/TU/WE/TH/FR/SA).
   * Omitted: event lands on the calendar date of the astronomical phase in
   * the kennel's timezone (FMH3 shape).
   * Set: event lands on the matching weekday per `anchorRule` (DCFMH3 shape).
   */
  anchorWeekday?: AnchorWeekday;
  /**
   * How to snap to anchorWeekday relative to the phase date. Required iff
   * `anchorWeekday` is set (and vice versa).
   *   "nearest"        — closest occurrence; ties break forward (later).
   *   "on-or-after"    — first matching weekday on or after the phase.
   *   "on-or-before"   — first matching weekday on or before the phase.
   */
  anchorRule?: AnchorRule;
}

export type AnchorWeekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
export type AnchorRule = "nearest" | "on-or-after" | "on-or-before";

/** Allowed values for runtime validation; mirrors `AnchorWeekday`. */
export const ANCHOR_WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
/** Allowed values for runtime validation; mirrors `AnchorRule`. */
export const ANCHOR_RULES = ["nearest", "on-or-after", "on-or-before"] as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Wraparound-safe distance between two phase fractions in [0, 1).
 *
 * The moon's phase is cyclic — phase 0.99 and 0.01 are both ~1% from new moon
 * (target 0.0), not 98% apart. A naive `Math.abs(a - b)` is wrong at the
 * 1.0 → 0.0 boundary. This function returns the shortest cyclic distance,
 * which has a maximum of 0.5 (a quarter moon away from any target phase).
 *
 * Symmetric in its arguments.
 */
export function phaseDistance(actualPhase: number, targetPhase: number): number {
  const d = Math.abs(actualPhase - targetPhase);
  return Math.min(d, 1 - d);
}

/**
 * Generate UTC instants of full or new moons inside [windowStart, windowEnd].
 *
 * Algorithm:
 *   1. Walk daily noon-UTC across the window (with one day of padding on each
 *      side so a phase exactly at the boundary is still detected).
 *   2. A daily sample is a candidate if its phaseDistance is below ~0.05 AND
 *      it's a strict local minimum vs the previous day AND a non-strict local
 *      minimum vs the next day. (Strict-LT on one side breaks any equal-pair
 *      tie deterministically by picking the earlier date.) The 0.05 threshold
 *      is chosen so that exactly one daily sample per cycle qualifies — the
 *      sun's daily phase delta is ~0.034 so two consecutive days within the
 *      threshold is impossible.
 *   3. Refine each candidate to its sub-day astronomical instant by ternary
 *      search inside ±36h. The phaseDistance function is U-shaped (unimodal)
 *      near the target so ternary search converges quickly.
 *   4. Filter to the requested [windowStart, windowEnd] window.
 */
export function generateLunarPhaseInstants(
  phase: "full" | "new",
  windowStart: Date,
  windowEnd: Date,
): Date[] {
  if (windowStart.getTime() > windowEnd.getTime()) return [];

  const target = phase === "full" ? 0.5 : 0;

  // Sample once per day at noon UTC, padded ±1 day so boundary phases are seen.
  const sampleStart = startOfUtcDayNoon(windowStart) - DAY_MS;
  const sampleEnd = startOfUtcDayNoon(windowEnd) + DAY_MS;

  type Sample = { time: number; dist: number };
  const samples: Sample[] = [];
  for (let t = sampleStart; t <= sampleEnd; t += DAY_MS) {
    const phaseFrac = SunCalc.getMoonIllumination(new Date(t)).phase;
    samples.push({ time: t, dist: phaseDistance(phaseFrac, target) });
  }

  const candidates: Date[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const cur = samples[i];
    if (cur.dist > 0.05) continue;
    const prev = samples[i - 1];
    const next = samples[i + 1];
    // Strict-LT on the previous side (earlier-date wins on a tie),
    // non-strict on the next side.
    if (cur.dist < prev.dist && cur.dist <= next.dist) {
      const refined = refinePhaseInstant(target, cur.time - 36 * HOUR_MS, cur.time + 36 * HOUR_MS);
      candidates.push(new Date(refined));
    }
  }

  // Filter to requested window.
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  return candidates.filter((d) => d.getTime() >= startMs && d.getTime() <= endMs);
}

/**
 * Refine a phase candidate to the precise UTC instant by ternary search on
 * `phaseDistance`. The search range is wide enough (±36h) to bracket the
 * actual minimum even when our daily sample missed by half a day, and the
 * 1-minute precision is well below any kennel scheduling cadence.
 */
function refinePhaseInstant(target: number, lo: number, hi: number): number {
  let l = lo;
  let h = hi;
  // Ternary search converges to 1-minute precision in ~24 iterations on a 72h
  // bracket; the loop cap is dead headroom. SunCalc's intrinsic accuracy is
  // ~5 minutes, so sub-minute precision is already overkill.
  for (let i = 0; i < 60; i++) {
    if (h - l <= 60_000) break;
    const m1 = l + (h - l) / 3;
    const m2 = h - (h - l) / 3;
    const d1 = phaseDistance(SunCalc.getMoonIllumination(new Date(m1)).phase, target);
    const d2 = phaseDistance(SunCalc.getMoonIllumination(new Date(m2)).phase, target);
    if (d1 < d2) {
      h = m2;
    } else {
      l = m1;
    }
  }
  return Math.round((l + h) / 2);
}

/** Start-of-noon-UTC milliseconds for a given Date (used for daily sampling). */
function startOfUtcDayNoon(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
}

/**
 * Convert an astronomical UTC instant to a calendar date in the kennel's
 * timezone, returned as that local date represented as UTC noon (matching the
 * project's UTC-noon date convention used throughout the merge pipeline).
 *
 * Example: full moon at `2026-05-16T03:00:00Z` for `America/Los_Angeles`
 *   → local time `2026-05-15T20:00:00-07:00`
 *   → local date `2026-05-15`
 *   → returned as `2026-05-15T12:00:00.000Z`.
 *
 * Falls back to UTC if the timezone is invalid.
 */
export function lunarInstantToLocalDate(instant: Date, timezone: string): Date {
  return parseUtcNoonDate(formatYmdInTimezone(instant, timezone));
}

/**
 * Snap a calendar date (UTC noon) to the requested anchor weekday under one
 * of three rules. Pure date arithmetic — does not consult the moon phase.
 *
 * "nearest" ties (equidistant forward / back) break forward (later date) —
 * this matches kennel intent of leaning into the upcoming weekend rather
 * than the previous one. The fwd-distance < back-distance (strict) check
 * makes the tie deterministic.
 */
export function snapToAnchorWeekday(
  localDate: Date,
  anchorWeekday: AnchorWeekday,
  anchorRule: AnchorRule,
): Date {
  // WEEKDAY_NAMES from ../utils maps SU/MO/TU/WE/TH/FR/SA to JS getUTCDay() values (0..6).
  const target = WEEKDAY_NAMES[anchorWeekday];
  const current = localDate.getUTCDay();
  if (current === target) return localDate;

  const fwdDelta = (target - current + 7) % 7; // 1..6
  const backDelta = (current - target + 7) % 7; // 1..6

  let delta: number;
  if (anchorRule === "on-or-after") {
    delta = fwdDelta;
  } else if (anchorRule === "on-or-before") {
    delta = -backDelta;
  } else {
    // nearest: ties break forward (later) → require strict-less for back.
    delta = backDelta < fwdDelta ? -backDelta : fwdDelta;
  }

  return new Date(localDate.getTime() + delta * DAY_MS);
}

/**
 * Top-level entry point: generate `YYYY-MM-DD` occurrence dates for a lunar
 * config inside a window, anchored to the kennel's timezone.
 *
 * Flow:
 *   1. Find UTC instants of the requested phase inside an extended window
 *      (padded by 7 days on each side so a phase outside the window can still
 *      snap into the window via `anchorWeekday`).
 *   2. Convert each instant to a local-date in the kennel's timezone.
 *   3. If `anchorWeekday` is set, snap to the requested weekday under
 *      `anchorRule`.
 *   4. Filter to the requested [windowStart, windowEnd] window (post-snap
 *      dates outside the window are dropped).
 *   5. Dedup (rare: two phases can snap to the same anchor weekday).
 *   6. Sort chronologically.
 */
export function generateLunarOccurrences(
  config: LunarConfig,
  windowStart: Date,
  windowEnd: Date,
): string[] {
  // Pad by 7 days so a phase that lands just outside [windowStart, windowEnd]
  // can still snap INTO the window via on-or-before / on-or-after.
  const paddedStart = new Date(windowStart.getTime() - 7 * DAY_MS);
  const paddedEnd = new Date(windowEnd.getTime() + 7 * DAY_MS);

  const instants = generateLunarPhaseInstants(config.phase, paddedStart, paddedEnd);
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  const out = new Set<string>();
  for (const instant of instants) {
    let local = lunarInstantToLocalDate(instant, config.timezone);
    if (config.anchorWeekday && config.anchorRule) {
      local = snapToAnchorWeekday(local, config.anchorWeekday, config.anchorRule);
    }
    const t = local.getTime();
    if (t < startMs || t > endMs) continue;
    out.add(toIsoDateString(local));
  }
  // Explicit comparator: ISO YYYY-MM-DD strings ARE chronological under
  // lexicographic order, but bare `.sort()` is locale-dependent in some
  // engines and trips Sonar S2871.
  return [...out].sort((a, b) => a.localeCompare(b));
}
