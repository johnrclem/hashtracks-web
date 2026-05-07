/**
 * Moon-phase glyph helper for the public hareline calendar view.
 *
 * Pure decoration — visually marks the day of each full and new moon in the
 * calendar grid so users can correlate the lunar STATIC_SCHEDULE entries with
 * the cycle. The actual occurrence dates for lunar kennels are rendered via
 * the existing canonical-event pipeline; this helper just adds a glyph in the
 * day-cell corner.
 *
 * Algorithm matches the lunar adapter's `phaseDistance` wraparound math: the
 * day's noon-UTC phase distance to the target is compared to its neighbors,
 * and the day is marked only when it's the local minimum of the cycle. This
 * guarantees exactly one glyph per cycle and avoids two-day double-marking
 * at threshold boundaries.
 *
 * See `moon-phase.test.ts` for the behavioral specification.
 */

import SunCalc from "suncalc";

/**
 * Wraparound-safe distance between two phase fractions in [0, 1).
 *
 * Inlined here (rather than imported from `@/adapters/static-schedule/lunar`)
 * because this module is loaded by the public hareline calendar — a client
 * component. The adapter's `lunar.ts` transitively imports server-only modules
 * (`safe-fetch` → `node:dns/promises`, `structure-hash` → `node:crypto`) via
 * `../utils`, which would either explode the client bundle or fail at build
 * time. Codex pass-6 finding — fixed here.
 *
 * The implementation mirrors the lunar adapter's helper exactly. If both
 * grow non-trivial, a shared client-safe `src/lib/phase-math.ts` would be
 * the next step; for two lines, duplication is honest and lower-risk.
 */
function phaseDistance(actualPhase: number, targetPhase: number): number {
  const d = Math.abs(actualPhase - targetPhase);
  return Math.min(d, 1 - d);
}

/** Public emoji glyphs matching the canonical Unicode moon-phase set. */
export const MOON_PHASE_GLYPHS = {
  full: "🌕",
  new: "🌑",
} as const;

/** Phase distance threshold for early skip — days well outside the cycle peak. */
const NEAR_PHASE_THRESHOLD = 0.05;

/**
 * Return "full", "new", or null for a given calendar day, evaluated against
 * the supplied IANA timezone.
 *
 * The day is marked only when its phase distance to the target (0.5 for full,
 * 0.0 for new) is the local minimum compared to the previous and next day,
 * sampled at noon **in the supplied timezone**. This matches the lunar
 * adapter's date-assignment rule (`lunarInstantToLocalDate`) so the glyph
 * fires on the same calendar day a lunar kennel in that timezone would
 * publish an event for. Pass `"UTC"` if no timezone-correlation is wanted.
 *
 * Without timezone support, a US-West-Coast user looking at the calendar
 * would see the glyph on the day AFTER an FMH3 SF event. Codex pass-2
 * finding — fixed here.
 *
 * `date` is interpreted as a UTC-noon date (the project's canonical day
 * representation); only the date components are read.
 */
export function getMoonPhaseGlyphForDate(
  date: Date,
  timezone = "UTC",
): "full" | "new" | null {
  // Resolve neighbor days through the same `localNoonInTimezoneMs` helper so
  // each sample is genuinely at local noon for its calendar day. Codex pass-5
  // finding: a naive `today ± 24h` is wrong on DST-transition days where
  // consecutive local noons are 23 or 25 hours apart, which can flip the
  // local-min comparison and mark/miss the wrong day.
  const yesterdayDateStr = utcDateString(addUtcDays(date, -1));
  const todayDateStr = utcDateString(date);
  const tomorrowDateStr = utcDateString(addUtcDays(date, 1));
  const yesterdayLocalNoonMs = localNoonInTimezoneMs(yesterdayDateStr, timezone);
  const todayLocalNoonMs = localNoonInTimezoneMs(todayDateStr, timezone);
  const tomorrowLocalNoonMs = localNoonInTimezoneMs(tomorrowDateStr, timezone);

  for (const phase of ["full", "new"] as const) {
    const target = phase === "full" ? 0.5 : 0;
    const today = phaseDistance(
      SunCalc.getMoonIllumination(new Date(todayLocalNoonMs)).phase,
      target,
    );
    if (today > NEAR_PHASE_THRESHOLD) continue;
    const yesterday = phaseDistance(
      SunCalc.getMoonIllumination(new Date(yesterdayLocalNoonMs)).phase,
      target,
    );
    const tomorrow = phaseDistance(
      SunCalc.getMoonIllumination(new Date(tomorrowLocalNoonMs)).phase,
      target,
    );
    // Strict-LT on the previous side, non-strict on the next side: deterministic
    // tie-break to the earlier date when two consecutive samples are equal.
    if (today < yesterday && today <= tomorrow) {
      return phase;
    }
  }
  return null;
}

/** Format a Date's UTC date components as YYYY-MM-DD. */
function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `days` to a Date's UTC date components and return a new Date. */
function addUtcDays(d: Date, days: number): Date {
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + days,
    12, 0, 0,
  ));
}

/**
 * Resolve `YYYY-MM-DD` + IANA timezone to the UTC ms timestamp that represents
 * 12:00 local time on that calendar day. Falls back to UTC noon if the
 * timezone is invalid.
 *
 * Implementation: project the UTC-noon anchor into the requested zone via
 * `formatToParts`, read every component (year/month/day/hour/minute), and
 * compute the full delta — including day rollover and minute offsets. A
 * naive "extract only the hour" approach miscomputes UTC+13/+14 (Kiritimati,
 * day-rollover) and half-/quarter-hour zones (Kathmandu UTC+5:45, Adelaide
 * UTC+9:30). Codex pass-3 finding — fixed here.
 */
function localNoonInTimezoneMs(dateStr: string, timezone: string): number {
  const [yStr, mStr, dStr] = dateStr.split("-");
  const y = Number.parseInt(yStr, 10);
  const m = Number.parseInt(mStr, 10) - 1;
  const d = Number.parseInt(dStr, 10);
  const utcNoonMs = Date.UTC(y, m, d, 12, 0, 0);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcNoonMs));
  } catch {
    return utcNoonMs;
  }

  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") lookup[p.type] = p.value;
  }
  const localUtcEquivalentMs = Date.UTC(
    Number.parseInt(lookup.year, 10),
    Number.parseInt(lookup.month, 10) - 1,
    Number.parseInt(lookup.day, 10),
    Number.parseInt(lookup.hour, 10),
    Number.parseInt(lookup.minute, 10),
    0,
  );
  // The zone's offset (in ms) at the anchor — positive for east of UTC.
  const offsetMs = localUtcEquivalentMs - utcNoonMs;
  // Local noon for `dateStr` at this offset = UTC midnight + 12h − offset.
  const utcMidnightMs = Date.UTC(y, m, d, 0, 0, 0);
  return utcMidnightMs + 12 * 60 * 60 * 1000 - offsetMs;
}
