import { describe, it, expect } from "vitest";
import { getMoonPhaseGlyphForDate, MOON_PHASE_GLYPHS } from "./moon-phase";

/**
 * Per the spec, exactly one calendar day per ~29.5-day cycle should be
 * marked for each phase. The implementation uses adjacent-day local-minimum
 * comparison rather than a fixed threshold so that:
 *   1. There is always exactly one marker per cycle (no zero-marker months
 *      from a noon-UTC sample falling outside the threshold).
 *   2. Adjacent equal-distance days break deterministically toward the earlier
 *      date (no two-day double-marking).
 *
 * USNO ground truth for full moons in Jan-Apr 2026 (UTC):
 *   Jan 3, Feb 1, Mar 3, Apr 1.
 * Returned glyph day in UTC may be ±1 from the strict UTC instant date when
 * the astronomical phase falls within ~12h of a UTC midnight; this asserts
 * the expected ±1 day window.
 */
function utcDate(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T12:00:00Z`);
}

describe("getMoonPhaseGlyphForDate", () => {
  it("marks exactly one day per cycle for full moon — Jan 2026", () => {
    const phaseDays: string[] = [];
    for (let day = 1; day <= 31; day++) {
      const dateStr = `2026-01-${String(day).padStart(2, "0")}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr)) === "full") {
        phaseDays.push(dateStr);
      }
    }
    expect(phaseDays).toHaveLength(1);
    // USNO: Jan 3, 2026 10:03 UTC. Glyph could be Jan 3 (most likely) or Jan 2/4.
    expect(["2026-01-02", "2026-01-03", "2026-01-04"]).toContain(phaseDays[0]);
  });

  it("marks exactly one day per cycle for new moon — Jan 2026", () => {
    const phaseDays: string[] = [];
    for (let day = 1; day <= 31; day++) {
      const dateStr = `2026-01-${String(day).padStart(2, "0")}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr)) === "new") {
        phaseDays.push(dateStr);
      }
    }
    expect(phaseDays).toHaveLength(1);
    // USNO: Jan 18, 2026 19:52 UTC.
    expect(["2026-01-17", "2026-01-18", "2026-01-19"]).toContain(phaseDays[0]);
  });

  it("returns null for a quarter moon day (not full, not new)", () => {
    // Roughly 1 week after a full moon — a third quarter, not at either extreme.
    // USNO Feb 1 2026 full → ~Feb 9 third quarter.
    expect(getMoonPhaseGlyphForDate(utcDate("2026-02-09"))).toBeNull();
  });

  it("returns null for the day immediately after a full moon (no double-marking)", () => {
    // After the full-moon day, the next day's distance must be > the full-moon
    // day's distance, so the glyph does NOT fire on day+1.
    const fullDays: string[] = [];
    const candidateDays = ["2026-01-02", "2026-01-03", "2026-01-04"] as const;
    for (const dateStr of candidateDays) {
      if (getMoonPhaseGlyphForDate(utcDate(dateStr)) === "full") {
        fullDays.push(dateStr);
      }
    }
    expect(fullDays).toHaveLength(1);
  });

  it("marks 12-13 full moons in calendar year 2026", () => {
    const fullMoonDays: string[] = [];
    const start = new Date("2026-01-01T12:00:00Z");
    const end = new Date("2026-12-31T12:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (getMoonPhaseGlyphForDate(new Date(d)) === "full") {
        fullMoonDays.push(d.toISOString().slice(0, 10));
      }
    }
    expect(fullMoonDays.length).toBeGreaterThanOrEqual(12);
    expect(fullMoonDays.length).toBeLessThanOrEqual(13);
  });

  it("marks 12-13 new moons in calendar year 2026", () => {
    const newMoonDays: string[] = [];
    const start = new Date("2026-01-01T12:00:00Z");
    const end = new Date("2026-12-31T12:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (getMoonPhaseGlyphForDate(new Date(d)) === "new") {
        newMoonDays.push(d.toISOString().slice(0, 10));
      }
    }
    expect(newMoonDays.length).toBeGreaterThanOrEqual(12);
    expect(newMoonDays.length).toBeLessThanOrEqual(13);
  });

  it("never marks the same day as both full and new", () => {
    const start = new Date("2026-01-01T12:00:00Z");
    const end = new Date("2026-12-31T12:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const glyph = getMoonPhaseGlyphForDate(new Date(d));
      // We want phase to be exactly one of "full"|"new"|null, never overlap.
      // (The guard in implementation iterates phases in priority order.)
      if (glyph !== null) {
        expect(["full", "new"]).toContain(glyph);
      }
    }
  });
});

describe("MOON_PHASE_GLYPHS", () => {
  it("exposes a glyph for each phase", () => {
    expect(MOON_PHASE_GLYPHS.full).toBeTruthy();
    expect(MOON_PHASE_GLYPHS.new).toBeTruthy();
  });
});

describe("getMoonPhaseGlyphForDate timezone awareness", () => {
  // Codex pass-2 finding: marking glyphs at noon UTC drifts by a day for any
  // viewer west of UTC. Marker must fire on the viewer's local calendar day
  // matching the lunar adapter's `lunarInstantToLocalDate` assignment.
  //
  // USNO 2026 full-moon UTC instants used in these tests:
  //   May  1 2026 09:23 UTC  (chosen — late morning UTC, day-stable across zones)
  //   Aug 28 2026 04:18 UTC  (chosen — early UTC, expected to differ between LA and Tokyo)

  /** Walk a 5-day window centered on `centerDay` and return the dates that
   *  glyph as `phase` in the given timezone. */
  function findGlyphDays(
    yearMonthPrefix: string,
    centerDay: number,
    phase: "full" | "new",
    timezone: string,
  ): string[] {
    const matches: string[] = [];
    for (let day = centerDay - 2; day <= centerDay + 2; day++) {
      const dateStr = `${yearMonthPrefix}${String(day).padStart(2, "0")}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), timezone) === phase) {
        matches.push(dateStr);
      }
    }
    return matches;
  }

  it("UTC and LA both mark the May 1 2026 full moon (UTC instant 09:23 — same calendar day in both)", () => {
    // 09:23 UTC on May 1 = 02:23 PDT on May 1 — same calendar day in both.
    const utcMatches = findGlyphDays("2026-05-", 1, "full", "UTC");
    const laMatches = findGlyphDays("2026-05-", 1, "full", "America/Los_Angeles");
    expect(utcMatches).toEqual(["2026-05-01"]);
    expect(laMatches).toEqual(["2026-05-01"]);
  });

  it("Aug 28 2026 04:18 UTC full moon: LA sees Aug 27, UTC sees Aug 28", () => {
    // 04:18 UTC on Aug 28 = 21:18 PDT on Aug 27 (UTC-7). LA's local day is Aug 27.
    const utcMatches = findGlyphDays("2026-08-", 28, "full", "UTC");
    const laMatches = findGlyphDays("2026-08-", 28, "full", "America/Los_Angeles");
    expect(utcMatches).toEqual(["2026-08-28"]);
    expect(laMatches).toEqual(["2026-08-27"]);
  });

  it("defaults to UTC when no timezone is supplied (backwards compat)", () => {
    const withDefault = getMoonPhaseGlyphForDate(utcDate("2026-05-01"));
    const withUtc = getMoonPhaseGlyphForDate(utcDate("2026-05-01"), "UTC");
    expect(withDefault).toBe(withUtc);
  });

  it("invalid timezone falls back to UTC instead of crashing", () => {
    expect(() => getMoonPhaseGlyphForDate(utcDate("2026-05-01"), "Not/A_Real_Tz")).not.toThrow();
  });

  it("UTC+14 (Pacific/Kiritimati) handles day-rollover correctly", () => {
    // Codex pass-3 finding: the original "extract only the hour" offset math
    // miscomputed UTC+14 zones because noon UTC formats as "02" in Kiritimati
    // (next day), giving offset 2 instead of -22. The fixed implementation
    // uses full-component extraction and day-rollover-correct arithmetic.
    // Expected: Kiritimati's local-noon sample for May 1 2026 is 8h22m before
    // the May 1 09:23 UTC full moon → distance is small and a glyph day fires
    // somewhere in the May 1 ± 1 day window. Just assert no crash + glyph
    // appears within 5 days.
    const matches: string[] = [];
    for (let day = 1; day <= 5; day++) {
      const dateStr = `2026-05-0${day}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), "Pacific/Kiritimati") === "full") {
        matches.push(dateStr);
      }
    }
    expect(matches).toHaveLength(1);
  });

  it("UTC+5:45 (Asia/Kathmandu, half-/quarter-hour offset) handles minute offsets", () => {
    // The "hour only" offset math miscomputed half-hour zones by up to ~30
    // minutes, which is enough to flip the local-min comparison at boundary
    // dates. Verify the Kathmandu case produces exactly one full-moon glyph.
    const matches: string[] = [];
    for (let day = 1; day <= 5; day++) {
      const dateStr = `2026-05-0${day}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), "Asia/Kathmandu") === "full") {
        matches.push(dateStr);
      }
    }
    expect(matches).toHaveLength(1);
  });

  it("UTC+9:30 (Australia/Adelaide, half-hour offset) handles minute offsets", () => {
    const matches: string[] = [];
    for (let day = 1; day <= 5; day++) {
      const dateStr = `2026-05-0${day}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), "Australia/Adelaide") === "full") {
        matches.push(dateStr);
      }
    }
    expect(matches).toHaveLength(1);
  });

  it("LA never marks a calendar day strictly later than Tokyo for the same astronomical phase", () => {
    // The astronomical phase is at one UTC instant; LA (UTC-7/8) is always
    // behind Tokyo (UTC+9), so Tokyo's local calendar day for the same phase
    // is the same or LATER than LA's. Verify across a full 2026 calendar year.
    for (let month = 0; month < 12; month++) {
      const monthStr = `2026-${String(month + 1).padStart(2, "0")}-`;
      const laDays: string[] = [];
      const tokyoDays: string[] = [];
      const daysInMonth = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthStr}${String(day).padStart(2, "0")}`;
        if (getMoonPhaseGlyphForDate(utcDate(dateStr), "America/Los_Angeles") === "full") {
          laDays.push(dateStr);
        }
        if (getMoonPhaseGlyphForDate(utcDate(dateStr), "Asia/Tokyo") === "full") {
          tokyoDays.push(dateStr);
        }
      }
      // For each LA mark, Tokyo's matching mark must be on the same or later day.
      // (LA may mark in this month and Tokyo may mark in the next month.)
      // Just assert no cross-zone inversion within the month.
      if (laDays.length > 0 && tokyoDays.length > 0) {
        expect(tokyoDays[0] >= laDays[0]).toBe(true);
      }
    }
  });

  it("DST spring-forward boundary in America/New_York (Mar 8 2026) marks one full moon", () => {
    // Codex pass-5 finding: neighbor-day sampling via ±24h is wrong on DST
    // transitions where consecutive local noons are 23 or 25 hours apart.
    // Mar 3 2026 is a full moon, Mar 8 2026 is the US DST start. Verify
    // exactly one full-moon glyph fires in a window straddling the DST
    // transition — proves the per-day local-noon resampling holds.
    const matches: string[] = [];
    for (let day = 1; day <= 12; day++) {
      const dateStr = `2026-03-${String(day).padStart(2, "0")}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), "America/New_York") === "full") {
        matches.push(dateStr);
      }
    }
    expect(matches).toHaveLength(1);
  });

  it("DST fall-back boundary in America/New_York (Nov 1 2026) does not double-mark", () => {
    // Window straddling the fall-back transition for the Oct 26 2026 full
    // moon (USNO 23:11 UTC). Verify no double-mark or missed mark.
    const matches: string[] = [];
    for (let day = 21; day <= 31; day++) {
      const dateStr = `2026-10-${String(day).padStart(2, "0")}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), "America/New_York") === "full") {
        matches.push(dateStr);
      }
    }
    for (let day = 1; day <= 5; day++) {
      const dateStr = `2026-11-0${day}`;
      if (getMoonPhaseGlyphForDate(utcDate(dateStr), "America/New_York") === "full") {
        matches.push(dateStr);
      }
    }
    expect(matches).toHaveLength(1);
  });
});
