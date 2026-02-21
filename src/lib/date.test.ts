import { getTodayUtcNoon, parseUtcNoonDate } from "./date";

describe("getTodayUtcNoon", () => {
  it("returns a number (milliseconds timestamp)", () => {
    const result = getTodayUtcNoon();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("result corresponds to 12:00:00 UTC today", () => {
    const result = getTodayUtcNoon();
    const date = new Date(result);
    const now = new Date();

    expect(date.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(date.getUTCMonth()).toBe(now.getUTCMonth());
    expect(date.getUTCDate()).toBe(now.getUTCDate());
  });

  it("hours/minutes/seconds are exactly noon UTC", () => {
    const result = getTodayUtcNoon();
    const date = new Date(result);

    expect(date.getUTCHours()).toBe(12);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  });
});

describe("parseUtcNoonDate", () => {
  it("parses a valid YYYY-MM-DD string", () => {
    const result = parseUtcNoonDate("2026-02-21");

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1); // 0-indexed
    expect(result.getUTCDate()).toBe(21);
  });

  it("sets time to exactly 12:00:00 UTC", () => {
    const result = parseUtcNoonDate("2026-06-15");

    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("handles leap year date 2024-02-29", () => {
    const result = parseUtcNoonDate("2024-02-29");

    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(29);
    expect(result.getUTCHours()).toBe(12);
  });

  it("handles year boundary 2025-12-31", () => {
    const result = parseUtcNoonDate("2025-12-31");

    expect(result.getUTCFullYear()).toBe(2025);
    expect(result.getUTCMonth()).toBe(11);
    expect(result.getUTCDate()).toBe(31);
  });

  it("handles January 1st", () => {
    const result = parseUtcNoonDate("2026-01-01");

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(1);
  });
});
