import { describe, it, expect } from "vitest";
import { parseDate, inferStartTime, parseCSV } from "./adapter";

// ── parseDate ──

describe("parseDate", () => {
  it("parses M-D-YY with hyphens", () => {
    expect(parseDate("6-15-25")).toBe("2025-06-15");
  });

  it("parses M/D/YYYY with slashes", () => {
    expect(parseDate("7/1/2024")).toBe("2024-07-01");
  });

  it("parses M/DD/YY with slashes", () => {
    expect(parseDate("6/13/22")).toBe("2022-06-13");
  });

  it("handles 2-digit year boundary: 49 → 2049", () => {
    expect(parseDate("1/1/49")).toBe("2049-01-01");
  });

  it("handles 2-digit year boundary: 50 → 1950", () => {
    expect(parseDate("1/1/50")).toBe("1950-01-01");
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(parseDate("abc")).toBeNull();
  });

  it("returns null for month > 12", () => {
    expect(parseDate("13/1/25")).toBeNull();
  });

  it("returns null for day > 31", () => {
    expect(parseDate("1/32/25")).toBeNull();
  });

  it("pads single-digit month and day", () => {
    expect(parseDate("1/5/25")).toBe("2025-01-05");
  });
});

// ── inferStartTime ──

describe("inferStartTime", () => {
  const rules = {
    byDayOfWeek: { Mon: "19:00", Sat: "15:00" },
    default: "14:00",
  };

  it("returns time for matching day of week", () => {
    // 2026-02-16 is a Monday
    expect(inferStartTime("2026-02-16", rules)).toBe("19:00");
  });

  it("returns time for Saturday", () => {
    // 2026-02-14 is a Saturday
    expect(inferStartTime("2026-02-14", rules)).toBe("15:00");
  });

  it("returns default for unmatched day", () => {
    // 2026-02-15 is a Sunday
    expect(inferStartTime("2026-02-15", rules)).toBe("14:00");
  });

  it("returns undefined when no rules", () => {
    expect(inferStartTime("2026-02-14")).toBeUndefined();
  });
});

// ── parseCSV ──

describe("parseCSV", () => {
  it("parses simple unquoted fields", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCSV('"a,b",c,d')).toEqual([["a,b", "c", "d"]]);
  });

  it("handles escaped double-quotes inside quotes", () => {
    expect(parseCSV('"He said ""hello""",b')).toEqual([['He said "hello"', "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCSV("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles LF-only line endings", () => {
    expect(parseCSV("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("filters empty rows", () => {
    expect(parseCSV("a,b\n\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles trailing comma", () => {
    expect(parseCSV("a,b,")).toEqual([["a", "b"]]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("handles unquoted empty fields", () => {
    expect(parseCSV("a,,c")).toEqual([["a", "", "c"]]);
  });
});
