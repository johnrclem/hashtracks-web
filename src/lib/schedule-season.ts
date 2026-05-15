/**
 * Shared helpers for MM-DD season anchors on multi-cadence kennel schedules
 * (#1390). `ScheduleRule.validFrom` / `validUntil` are stored as "MM-DD" strings
 * because seasonality wraps across calendar years — a wintertime cadence like
 * `validFrom: "11-01"` / `validUntil: "02-28"` spans Dec 31 / Jan 1, so an ISO
 * date anchored to a specific year would lose meaning.
 *
 * The display layer (formatSchedule + kennel cards), Travel Mode projection, and
 * KennelDirectory filters all need to interpret these anchors consistently. This
 * module is the single source of truth — every consumer of the seasonal fields
 * should call into here rather than hand-rolling a wrap-aware comparison.
 *
 * Single-month-of-year semantics: anchors are inclusive on both ends. Day-of-year
 * (1–366) is used internally so leap days (Feb 29) are accepted cleanly.
 */

import { parseRRule } from "@/adapters/static-schedule/rrule-parser";

const MONTH_DAY_RE = /^(\d{2})-(\d{2})$/;

const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/**
 * One schedule slot for display. Built from a `Kennel.scheduleRules` row when
 * present; the legacy flat fields collapse to a single ScheduleSlot when not.
 */
export interface ScheduleSlot {
  rrule: string;
  startTime?: string | null;
  label?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  displayOrder?: number | null;
}

/**
 * Shared Prisma select fragment for `Kennel.scheduleRules` — used by every
 * render surface (kennels grid, region page, kennel detail, OG image) and
 * the directory filter source. Centralizes the shape so a future column add
 * doesn't go stale in 5 call sites.
 *
 * Use as: `prisma.kennel.findMany({ select: { ..., scheduleRules: SCHEDULE_RULES_SELECT } })`.
 */
export const SCHEDULE_RULES_SELECT = {
  where: { isActive: true },
  orderBy: { displayOrder: "asc" },
  select: {
    rrule: true,
    startTime: true,
    label: true,
    validFrom: true,
    validUntil: true,
    displayOrder: true,
  },
} as const;

interface MonthDay {
  month: number; // 1-12
  day: number;   // 1-31
}

/**
 * Parse an "MM-DD" anchor into a structured object. Returns null on malformed
 * input or invalid month/day combos. Feb 29 is accepted (leap-year-aware).
 */
export function parseMonthDay(raw: string | null | undefined): MonthDay | null {
  if (!raw) return null;
  const match = MONTH_DAY_RE.exec(raw.trim());
  if (!match) return null;
  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  // Use leap year 2024 for the last-day check so Feb 29 is permitted.
  const lastDayOfMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
  if (day < 1 || day > lastDayOfMonth) return null;
  return { month, day };
}

/**
 * Convert MM-DD to day-of-year (1–366) using a leap-year reference so Feb 29
 * gets day 60. Comparison logic only cares about ordering; the absolute year
 * doesn't matter.
 */
function toDayOfYear(md: MonthDay): number {
  const start = Date.UTC(2024, 0, 1);
  const target = Date.UTC(2024, md.month - 1, md.day);
  return Math.round((target - start) / 86_400_000) + 1;
}

/**
 * Day-of-year (1–366) for an arbitrary Date, in UTC. Non-leap years map Mar 1
 * → 61, Feb 29 → 60 (same as leap year). The constant 2024 reference keeps the
 * mapping consistent with parsed MM-DD anchors.
 */
function dateToDayOfYear(d: Date): number {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  // Days-before-month table (0-indexed). Pad Feb to leap-year width so the
  // result aligns with leap-year MM-DD parsing.
  const dim = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let result = day;
  for (let i = 0; i < month; i++) result += dim[i];
  // Non-leap years past Feb shift one day relative to the leap-year reference;
  // bump so that Mar 1 in a non-leap year maps to day 61 (same as 2024 Mar 1).
  if (!isLeap && month >= 2) result += 1;
  return result;
}

/**
 * Is `today` within the [validFrom, validUntil] season? Both bounds are
 * inclusive. Wrap-around is supported: `validFrom: "11-01"` / `validUntil:
 * "02-28"` returns true for any November–February date. When BOTH bounds are
 * null/missing, returns true (rule is always-on, no seasonal gating).
 *
 * Returns true when exactly one bound is present and falsy on the other,
 * treating the missing side as open-ended in that direction.
 */
export function isWithinSeason(
  today: Date,
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
): boolean {
  const from = parseMonthDay(validFrom);
  const until = parseMonthDay(validUntil);
  if (!from && !until) return true;
  const todayDoy = dateToDayOfYear(today);
  const fromDoy = from ? toDayOfYear(from) : -Infinity;
  const untilDoy = until ? toDayOfYear(until) : Infinity;
  if (fromDoy <= untilDoy) {
    // Non-wrapping span: [from, until] is a contiguous interval within one year.
    return todayDoy >= fromDoy && todayDoy <= untilDoy;
  }
  // Wrap-around: e.g. Nov 1 → Feb 28. "In season" = on/after from OR on/before until.
  return todayDoy >= fromDoy || todayDoy <= untilDoy;
}

/**
 * Does the [windowStart, windowEnd] range overlap the [validFrom, validUntil]
 * MM-DD season? Used by Travel Mode to gate off ENTIRE rules (including
 * possible-activity LOW-confidence rules that produce no individual dates) when
 * the search window is wholly out of season. Without this gate, a winter-only
 * rule with confidence=LOW would emit a date-null "possible activity" entry on
 * a July search because the per-date filter only fires when there ARE dates.
 *
 * When BOTH anchors are null/missing, returns true (always-on rule). When the
 * window is ≥ 1 year, returns true unconditionally — any season necessarily
 * overlaps a year-long window. Otherwise walks daily and short-circuits on
 * first in-season day.
 */
export function windowOverlapsSeason(
  windowStart: Date,
  windowEnd: Date,
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
): boolean {
  if (!validFrom && !validUntil) return true;
  const ms = windowEnd.getTime() - windowStart.getTime();
  if (ms >= 366 * 86_400_000) return true;
  const days = Math.ceil(ms / 86_400_000);
  for (let i = 0; i <= days; i++) {
    const d = new Date(windowStart.getTime() + i * 86_400_000);
    if (d.getTime() > windowEnd.getTime()) break;
    if (isWithinSeason(d, validFrom, validUntil)) return true;
  }
  return false;
}

/**
 * Format a season hint suitable for display. Examples:
 *   ("Summer", "03-01", "10-31") → "Summer, Mar–Oct"
 *   ("Winter", "11-01", "02-28") → "Winter, Nov–Feb"
 *   ("Monthly", null, null)      → "Monthly"
 *   (null, "03-01", "10-31")     → "Mar–Oct"
 *   (null, null, null)           → null   (no hint to show)
 *   ("Summer", "03-01", null)    → "Summer, from Mar"
 *   (null, null, "10-31")        → "until Oct"
 */
export function formatSeasonHint(
  label: string | null | undefined,
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
): string | null {
  const trimmedLabel = label?.trim() || null;
  const from = parseMonthDay(validFrom);
  const until = parseMonthDay(validUntil);
  const rangeText = formatMonthRange(from, until);
  if (trimmedLabel && rangeText) return `${trimmedLabel}, ${rangeText}`;
  if (trimmedLabel) return trimmedLabel;
  return rangeText;
}

function formatMonthRange(from: MonthDay | null, until: MonthDay | null): string | null {
  if (from && until) return `${MONTH_ABBREV[from.month - 1]}–${MONTH_ABBREV[until.month - 1]}`;
  if (from) return `from ${MONTH_ABBREV[from.month - 1]}`;
  if (until) return `until ${MONTH_ABBREV[until.month - 1]}`;
  return null;
}

/**
 * Collect every weekday name this kennel runs on, considering both the legacy
 * flat `scheduleDayOfWeek` and any `scheduleRules`. Single source of truth for
 * the KennelDirectory day filter and the region-page intro/metadata "days"
 * computations.
 *
 * Rejects multi-day BYDAY (`BYDAY=SA,SU`) so it stays in lockstep with
 * `formatSchedule`'s RRULE renderer — only single-weekday slots round-trip
 * through the UI.
 */
export function collectKennelWeekdays(k: {
  scheduleDayOfWeek?: string | null;
  scheduleRules?: ScheduleSlot[] | null;
}): string[] {
  const days = new Set<string>();
  if (k.scheduleDayOfWeek) days.add(k.scheduleDayOfWeek);
  for (const rule of k.scheduleRules ?? []) {
    const parsed = safeParseRrule(rule.rrule);
    if (parsed?.byDay) days.add(WEEKDAY_NAMES[parsed.byDay.day]);
  }
  return [...days];
}

/**
 * Derive legacy-style frequency labels (Weekly / Biweekly / Monthly) this
 * kennel matches, considering both `scheduleFrequency` and any `scheduleRules`.
 */
export function collectKennelFrequencies(k: {
  scheduleFrequency?: string | null;
  scheduleRules?: ScheduleSlot[] | null;
}): string[] {
  const labels = new Set<string>();
  if (k.scheduleFrequency) labels.add(k.scheduleFrequency);
  for (const rule of k.scheduleRules ?? []) {
    const parsed = safeParseRrule(rule.rrule);
    if (!parsed) continue;
    if (parsed.freq === "WEEKLY") {
      // Map only interval=1 → Weekly and interval=2 → Biweekly. Higher
      // intervals (triweekly, quadweekly, etc.) aren't part of the
      // FilterBar's dropdown vocabulary, so we don't fabricate a label for
      // them — the rule simply doesn't contribute to the frequency dropdown.
      if (parsed.interval === 1) labels.add("Weekly");
      else if (parsed.interval === 2) labels.add("Biweekly");
    } else if (parsed.freq === "MONTHLY") {
      labels.add("Monthly");
    }
  }
  return [...labels];
}

/** Wrap parseRRule with a try/catch so a single malformed seed RRULE doesn't
 *  blow up the filter/derivation paths. Callers fall through to "no match". */
function safeParseRrule(rrule: string): ReturnType<typeof parseRRule> | null {
  try {
    return parseRRule(rrule);
  } catch {
    return null;
  }
}
