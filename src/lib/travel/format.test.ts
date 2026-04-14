import { describe, it, expect } from "vitest";
import { formatDateCompact, daysBetween, getKennelInitials } from "./format";

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
});

describe("daysBetween", () => {
  it("returns the date span in days", () => {
    expect(daysBetween("2026-04-12", "2026-04-26")).toBe(14);
  });

  it("returns at least 1 for same-day ranges", () => {
    expect(daysBetween("2026-04-12", "2026-04-12")).toBe(1);
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
