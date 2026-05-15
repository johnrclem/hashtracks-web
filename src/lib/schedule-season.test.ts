import { describe, it, expect } from "vitest";
import {
  parseMonthDay,
  isWithinSeason,
  formatSeasonHint,
} from "./schedule-season";

describe("parseMonthDay", () => {
  it.each([
    ["03-01", { month: 3, day: 1 }],
    ["11-30", { month: 11, day: 30 }],
    ["02-29", { month: 2, day: 29 }], // leap-year-aware
    ["12-31", { month: 12, day: 31 }],
    ["01-01", { month: 1, day: 1 }],
  ])("parses valid anchor %s", (input, expected) => {
    expect(parseMonthDay(input)).toEqual(expected);
  });

  it.each([
    "13-01",  // invalid month
    "00-15",  // invalid month (zero)
    "02-30",  // invalid day for Feb (leap-year-aware accepts 02-29, rejects 02-30)
    "04-31",  // invalid day for April
    "summer", // not a date
    "3-1",    // wrong format (missing leading zeros)
    "2024-03-01", // full date
    "",
  ])("rejects invalid anchor %p", (input) => {
    expect(parseMonthDay(input)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(parseMonthDay(null)).toBeNull();
    expect(parseMonthDay(undefined)).toBeNull();
  });
});

describe("isWithinSeason", () => {
  it("returns true when both bounds are missing (always-on rule)", () => {
    expect(isWithinSeason(new Date("2026-05-15T12:00:00Z"), null, null)).toBe(true);
    expect(isWithinSeason(new Date("2026-05-15T12:00:00Z"), undefined, undefined)).toBe(true);
  });

  it.each([
    // Summer span: Mar 1 → Oct 31, non-wrapping.
    ["2026-03-01", "03-01", "10-31", true,  "first day of summer"],
    ["2026-10-31", "03-01", "10-31", true,  "last day of summer"],
    ["2026-07-15", "03-01", "10-31", true,  "mid-summer"],
    ["2026-02-28", "03-01", "10-31", false, "day before summer"],
    ["2026-11-01", "03-01", "10-31", false, "day after summer"],
    ["2026-12-25", "03-01", "10-31", false, "deep winter, non-wrapping span"],
  ])("non-wrapping summer span: %s [%s..%s] → %s (%s)", (date, from, until, expected) => {
    expect(isWithinSeason(new Date(`${date}T12:00:00Z`), from, until)).toBe(expected);
  });

  it.each([
    // Winter span: Nov 1 → Feb 28, wraps across year boundary.
    ["2026-11-01", "11-01", "02-28", true,  "first day of winter"],
    ["2026-12-31", "11-01", "02-28", true,  "year-end during winter"],
    ["2026-01-15", "11-01", "02-28", true,  "mid-winter (post-wrap)"],
    ["2026-02-28", "11-01", "02-28", true,  "last day of winter (non-leap year)"],
    ["2026-03-01", "11-01", "02-28", false, "day after winter"],
    ["2026-10-31", "11-01", "02-28", false, "day before winter"],
    ["2026-07-15", "11-01", "02-28", false, "deep summer, wrapping span"],
  ])("wrapping winter span: %s [%s..%s] → %s (%s)", (date, from, until, expected) => {
    expect(isWithinSeason(new Date(`${date}T12:00:00Z`), from, until)).toBe(expected);
  });

  it("accepts Feb 29 as an anchor and reads non-leap-year dates consistently", () => {
    // validUntil: "02-29" — in a non-leap year, Feb 28 is the last in-season day.
    expect(isWithinSeason(new Date("2027-02-28T12:00:00Z"), "11-01", "02-29")).toBe(true);
    expect(isWithinSeason(new Date("2027-03-01T12:00:00Z"), "11-01", "02-29")).toBe(false);
  });

  it("handles open-ended bounds (only validFrom set)", () => {
    // "from Mar 1, no end" — true for any date Mar 1 onward
    expect(isWithinSeason(new Date("2026-03-01T12:00:00Z"), "03-01", null)).toBe(true);
    expect(isWithinSeason(new Date("2026-12-31T12:00:00Z"), "03-01", null)).toBe(true);
    expect(isWithinSeason(new Date("2026-02-28T12:00:00Z"), "03-01", null)).toBe(false);
  });

  it("handles open-ended bounds (only validUntil set)", () => {
    // "until Oct 31, no start" — true for any date up through Oct 31
    expect(isWithinSeason(new Date("2026-01-01T12:00:00Z"), null, "10-31")).toBe(true);
    expect(isWithinSeason(new Date("2026-10-31T12:00:00Z"), null, "10-31")).toBe(true);
    expect(isWithinSeason(new Date("2026-11-01T12:00:00Z"), null, "10-31")).toBe(false);
  });

  it("treats malformed anchors as missing (rule defaults to in-season)", () => {
    // "summer" doesn't parse; with both bounds malformed, behave as always-on.
    expect(isWithinSeason(new Date("2026-07-15T12:00:00Z"), "summer", "winter")).toBe(true);
  });
});

describe("formatSeasonHint", () => {
  it.each<[string | null, string | null, string | null, string | null]>([
    ["Summer", "03-01", "10-31", "Summer, Mar–Oct"],
    ["Winter", "11-01", "02-28", "Winter, Nov–Feb"],
    ["Monthly", null, null, "Monthly"],
    [null, "03-01", "10-31", "Mar–Oct"],
    [null, null, null, null],
    ["Summer", "03-01", null, "Summer, from Mar"],
    [null, null, "10-31", "until Oct"],
    ["", "03-01", "10-31", "Mar–Oct"], // empty label falls back to range
    ["Full Moon", null, null, "Full Moon"],
  ])("label=%p validFrom=%p validUntil=%p → %p", (label, from, until, expected) => {
    expect(formatSeasonHint(label, from, until)).toBe(expected);
  });

  it("trims whitespace-only labels to null", () => {
    expect(formatSeasonHint("   ", "03-01", "10-31")).toBe("Mar–Oct");
    expect(formatSeasonHint("   ", null, null)).toBeNull();
  });

  it("ignores malformed anchors (label-only output)", () => {
    expect(formatSeasonHint("Summer", "13-99", null)).toBe("Summer");
    expect(formatSeasonHint(null, "13-99", "99-99")).toBeNull();
  });
});
