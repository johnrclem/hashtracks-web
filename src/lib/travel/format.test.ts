import { describe, it, expect } from "vitest";
import {
  formatDateCompact,
  daysBetween,
  getKennelInitials,
  formatDistanceWithWalk,
  formatDayHeader,
} from "./format";

describe("formatDateCompact", () => {
  it("formats without weekday by default", () => {
    expect(formatDateCompact("2026-04-14")).toBe("Apr 14");
  });

  it("prepends weekday when withWeekday is true", () => {
    // 2026-04-12 is a Sunday, 2026-04-13 is a Monday
    expect(formatDateCompact("2026-04-12", { withWeekday: true })).toBe("Sun, Apr 12");
    expect(formatDateCompact("2026-04-13", { withWeekday: true })).toBe("Mon, Apr 13");
  });

  it("uses UTC timezone so the DOW doesn't drift for non-UTC clients", () => {
    // Regression: a client in US Pacific would see "Sat, Apr 11" for this
    // date without timeZone: "UTC", because the Date object would be
    // interpreted at local midnight. UTC-noon keeps the day stable.
    expect(formatDateCompact("2026-04-12", { withWeekday: true })).toBe("Sun, Apr 12");
  });

  it("accepts ISO-8601 timestamps without producing Invalid Date", () => {
    // Regression: TravelResultFilters chip tooltips pass full ISO timestamps
    // from datesByDay. Without the defensive slice the helper appended
    // "T12:00:00Z" twice and rendered "Invalid Date" in tooltips/aria-labels.
    expect(formatDateCompact("2026-04-14T12:00:00.000Z")).toBe("Apr 14");
    expect(
      formatDateCompact("2026-04-14T12:00:00.000Z", { withWeekday: true }),
    ).toBe("Tue, Apr 14");
  });
});

describe("daysBetween", () => {
  it("returns the date span in days", () => {
    expect(daysBetween("2026-04-12", "2026-04-26")).toBe(14);
  });

  it("returns at least 1 for same-day ranges", () => {
    expect(daysBetween("2026-04-12", "2026-04-12")).toBe(1);
  });
});

describe("formatDistanceWithWalk", () => {
  it("shows minutes for short walks", () => {
    expect(formatDistanceWithWalk(1.2)).toBe("1.2 km · ~14 min walk");
    expect(formatDistanceWithWalk(2.5)).toBe("2.5 km · ~30 min walk");
  });

  it("shows hours for longer walks (≤ 90 min)", () => {
    expect(formatDistanceWithWalk(5.5)).toBe("5.5 km · ~1 h walk");
    expect(formatDistanceWithWalk(7)).toBe("7.0 km · ~1 h walk");
  });

  it("falls back to 'short drive' past 90 min walking", () => {
    expect(formatDistanceWithWalk(12)).toBe("12.0 km · short drive");
    expect(formatDistanceWithWalk(20)).toBe("20.0 km · short drive");
  });

  it("renders <1 km label and never reports 0 minutes", () => {
    // 0.5 km / 5 km/h = 6 min — but anything sub-1km gets the "<1 km" label.
    expect(formatDistanceWithWalk(0.5)).toBe("<1 km · ~6 min walk");
    // Exact 0 still reports 1 min minimum (defensive — caller typically has > 0).
    expect(formatDistanceWithWalk(0)).toBe("<1 km · ~1 min walk");
  });
});

describe("formatDayHeader", () => {
  it("renders long-form day headers in UTC", () => {
    expect(formatDayHeader("2026-04-14")).toBe("Tuesday, April 14");
    expect(formatDayHeader("2026-04-12T12:00:00.000Z")).toBe("Sunday, April 12");
  });
});

describe("getKennelInitials", () => {
  it("extracts first letters of first two words", () => {
    expect(getKennelInitials("Brooklyn Hash")).toBe("BH");
    expect(getKennelInitials("New York City Hash")).toBe("NY");
  });

  it("handles single-word names", () => {
    expect(getKennelInitials("Larrikins")).toBe("L");
  });

  it("uppercases initials", () => {
    expect(getKennelInitials("aces of spades")).toBe("AO");
  });
});
