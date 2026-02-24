import {
  StaticScheduleAdapter,
  parseRRule,
  generateOccurrences,
} from "./adapter";
import type { Source } from "@/generated/prisma/client";

function makeSource(config: Record<string, unknown>, url = "https://www.facebook.com/groups/rumsonh3/"): Source {
  return {
    id: "src-1",
    name: "Test Static Schedule",
    url,
    type: "STATIC_SCHEDULE",
    enabled: true,
    trustLevel: 3,
    scrapeFreq: "weekly",
    scrapeDays: 90,
    config,
    lastScrapeAt: null,
    healthStatus: "UNKNOWN",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Source;
}

describe("parseRRule", () => {
  it("parses weekly Saturday", () => {
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=SA");
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.interval).toBe(1);
    expect(rule.byDay).toEqual({ day: 6 });
  });

  it("parses biweekly Saturday", () => {
    const rule = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.interval).toBe(2);
    expect(rule.byDay).toEqual({ day: 6 });
  });

  it("parses monthly 2nd Saturday", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=2SA");
    expect(rule.freq).toBe("MONTHLY");
    expect(rule.byDay).toEqual({ day: 6, nth: 2 });
  });

  it("parses monthly last Friday", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=-1FR");
    expect(rule.freq).toBe("MONTHLY");
    expect(rule.byDay).toEqual({ day: 5, nth: -1 });
  });

  it("parses monthly by day of month", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(rule.freq).toBe("MONTHLY");
    expect(rule.byMonthDay).toBe(15);
  });

  it("throws on missing FREQ", () => {
    expect(() => parseRRule("BYDAY=SA")).toThrow("missing FREQ");
  });

  it("throws on invalid BYDAY", () => {
    expect(() => parseRRule("FREQ=WEEKLY;BYDAY=XX")).toThrow("Unknown day");
  });

  // Fix 3: Whitespace handling
  it("handles whitespace around semicolons", () => {
    const rule = parseRRule("FREQ=WEEKLY; BYDAY=SA");
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.byDay).toEqual({ day: 6 });
  });

  it("handles whitespace around equals", () => {
    const rule = parseRRule("FREQ = WEEKLY ; BYDAY = SA");
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.byDay).toEqual({ day: 6 });
  });

  // Fix 1: Validation
  it("throws on INTERVAL=0", () => {
    expect(() => parseRRule("FREQ=WEEKLY;INTERVAL=0;BYDAY=SA")).toThrow("Invalid INTERVAL");
  });

  it("throws on INTERVAL=-1", () => {
    expect(() => parseRRule("FREQ=WEEKLY;INTERVAL=-1;BYDAY=SA")).toThrow("Invalid INTERVAL");
  });

  it("throws on BYMONTHDAY=0", () => {
    expect(() => parseRRule("FREQ=MONTHLY;BYMONTHDAY=0")).toThrow("Invalid BYMONTHDAY");
  });

  it("throws on BYMONTHDAY=32", () => {
    expect(() => parseRRule("FREQ=MONTHLY;BYMONTHDAY=32")).toThrow("Invalid BYMONTHDAY");
  });

  it("throws on BYDAY=0SA (nth cannot be 0)", () => {
    expect(() => parseRRule("FREQ=MONTHLY;BYDAY=0SA")).toThrow("nth position cannot be 0");
  });

  // Fix 4: Unsupported FREQ / missing BYDAY
  it("throws on unsupported FREQ=DAILY", () => {
    expect(() => parseRRule("FREQ=DAILY;BYDAY=SA")).toThrow("Unsupported FREQ");
  });

  it("throws on unsupported FREQ=YEARLY", () => {
    expect(() => parseRRule("FREQ=YEARLY;BYDAY=SA")).toThrow("Unsupported FREQ");
  });

  it("throws on WEEKLY without BYDAY", () => {
    expect(() => parseRRule("FREQ=WEEKLY")).toThrow("WEEKLY RRULE requires BYDAY");
  });
});

describe("generateOccurrences", () => {
  it("generates weekly Saturday dates", () => {
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=SA");
    // Use a fixed window: 2026-01-01 to 2026-01-31
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 0, 31, 23, 59, 59));
    const dates = generateOccurrences(rule, start, end);

    // Saturdays in Jan 2026: 3, 10, 17, 24, 31
    expect(dates).toEqual([
      "2026-01-03",
      "2026-01-10",
      "2026-01-17",
      "2026-01-24",
      "2026-01-31",
    ]);
  });

  it("generates biweekly Saturday dates", () => {
    const rule = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 0, 31, 23, 59, 59));
    const dates = generateOccurrences(rule, start, end);

    // Every other Saturday starting from first found
    expect(dates.length).toBeLessThanOrEqual(3);
    // All should be Saturdays
    for (const d of dates) {
      const dayOfWeek = new Date(d + "T12:00:00Z").getUTCDay();
      expect(dayOfWeek).toBe(6);
    }
  });

  it("generates stable biweekly dates with anchorDate", () => {
    const rule = parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    const anchor = "2026-01-03"; // Known Saturday

    // Two different windows that partially overlap
    const window1Start = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const window1End = new Date(Date.UTC(2026, 1, 28, 12, 0, 0));
    const dates1 = generateOccurrences(rule, window1Start, window1End, anchor);

    const window2Start = new Date(Date.UTC(2026, 0, 10, 12, 0, 0));
    const window2End = new Date(Date.UTC(2026, 2, 10, 12, 0, 0));
    const dates2 = generateOccurrences(rule, window2Start, window2End, anchor);

    // Overlapping dates should match — dates in both windows should be identical
    const overlap = dates1.filter((d) => dates2.includes(d));
    expect(overlap.length).toBeGreaterThan(0);

    // All dates should be every-other Saturday from the anchor
    const anchorMs = new Date(anchor + "T12:00:00Z").getTime();
    for (const d of [...dates1, ...dates2]) {
      const dateMs = new Date(d + "T12:00:00Z").getTime();
      const daysDiff = Math.round((dateMs - anchorMs) / 86_400_000);
      expect(daysDiff % 14).toBe(0); // exactly 14-day intervals from anchor
    }
  });

  it("generates monthly 2nd Saturday dates", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=2SA");
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 5, 30, 23, 59, 59));
    const dates = generateOccurrences(rule, start, end);

    // 6 months → 6 dates
    expect(dates).toHaveLength(6);
    // 2nd Saturday of Jan 2026 = Jan 10
    expect(dates[0]).toBe("2026-01-10");
    // 2nd Saturday of Feb 2026 = Feb 14
    expect(dates[1]).toBe("2026-02-14");
  });

  it("generates monthly by day of month", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYMONTHDAY=15");
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 2, 31, 23, 59, 59));
    const dates = generateOccurrences(rule, start, end);

    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("generates monthly last Friday", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=-1FR");
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 2, 31, 23, 59, 59));
    const dates = generateOccurrences(rule, start, end);

    // Last Friday of Jan 2026 = Jan 30, Feb = Feb 27, Mar = Mar 27
    expect(dates).toHaveLength(3);
    for (const d of dates) {
      const dayOfWeek = new Date(d + "T12:00:00Z").getUTCDay();
      expect(dayOfWeek).toBe(5); // Friday
    }
  });

  it("returns empty array for window with no matching occurrences", () => {
    // Weekly Saturday in a range that's only Monday-Friday
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=SA");
    const start = new Date(Date.UTC(2026, 0, 5, 0, 0, 0)); // Monday
    const end = new Date(Date.UTC(2026, 0, 9, 23, 59, 59)); // Friday
    const dates = generateOccurrences(rule, start, end);
    expect(dates).toEqual([]);
  });
});

describe("StaticScheduleAdapter", () => {
  const adapter = new StaticScheduleAdapter();

  it("returns error for null config", async () => {
    const source = makeSource(null as never);
    source.config = null;
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("config");
  });

  it("returns error for missing kennelTag", async () => {
    const source = makeSource({ rrule: "FREQ=WEEKLY;BYDAY=SA" });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("kennelTag");
  });

  it("returns error for missing rrule", async () => {
    const source = makeSource({ kennelTag: "Rumson" });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("rrule");
  });

  it("returns error for invalid rrule syntax", async () => {
    const source = makeSource({ kennelTag: "Rumson", rrule: "NOTAFREQ=WEEKLY;BYDAY=SA" });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("RRULE");
  });

  it("returns error for unsupported FREQ", async () => {
    const source = makeSource({ kennelTag: "Rumson", rrule: "FREQ=DAILY;BYDAY=SA" });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("Unsupported FREQ");
  });

  it("generates events for weekly Saturday within default 90-day window", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source);

    expect(result.errors).toHaveLength(0);
    // 90 days in each direction → ~180 days → ~25-26 Saturdays
    expect(result.events.length).toBeGreaterThanOrEqual(24);
    expect(result.events.length).toBeLessThanOrEqual(27);
  });

  it("assigns kennelTag to all events", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.kennelTag).toBe("Rumson");
    }
  });

  it("sets sourceUrl to source.url", async () => {
    const fbUrl = "https://www.facebook.com/p/Rumson-H3-100063637060523/";
    const source = makeSource(
      { kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA" },
      fbUrl,
    );
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.sourceUrl).toBe(fbUrl);
    }
  });

  it("accepts 24-hour startTime HH:MM", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      startTime: "10:17",
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(event.startTime).toBe("10:17");
    }
  });

  it("rejects non-HH:MM startTime (returns undefined)", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      startTime: "10:17 AM",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.startTime).toBeUndefined();
    }
  });

  it("omits startTime when not configured", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.startTime).toBeUndefined();
    }
  });

  it("populates defaultTitle on all events", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      defaultTitle: "Rumson H3 Weekly Run",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.title).toBe("Rumson H3 Weekly Run");
    }
  });

  it("populates defaultLocation on all events", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      defaultLocation: "Rumson, NJ",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.location).toBe("Rumson, NJ");
    }
  });

  it("populates defaultDescription on all events", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      defaultDescription: "Check Facebook",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.description).toBe("Check Facebook");
    }
  });

  it("respects custom days option", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source, { days: 14 });

    // 14 days each direction → ~28 days → ~4 Saturdays
    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.events.length).toBeLessThanOrEqual(5);
  });

  it("generates YYYY-MM-DD date strings", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("includes diagnosticContext with rrule and occurrence count", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source);

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
    expect(result.diagnosticContext!.occurrencesGenerated).toBe(result.events.length);
    expect(result.diagnosticContext!.windowDays).toBe(90);
  });

  it("generates all Saturdays as day-of-week 6", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
    });
    const result = await adapter.fetch(source);

    for (const event of result.events) {
      const date = new Date(event.date + "T12:00:00Z");
      expect(date.getUTCDay()).toBe(6);
    }
  });

  it("handles biweekly schedule", async () => {
    const source = makeSource({
      kennelTag: "TestKennel",
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
    });
    const weeklyResult = await adapter.fetch(
      makeSource({ kennelTag: "TestKennel", rrule: "FREQ=WEEKLY;BYDAY=SA" }),
    );
    const biweeklyResult = await adapter.fetch(source);

    // Biweekly should have roughly half the events of weekly
    expect(biweeklyResult.events.length).toBeLessThan(weeklyResult.events.length);
    expect(biweeklyResult.events.length).toBeGreaterThanOrEqual(
      Math.floor(weeklyResult.events.length / 2) - 1,
    );
  });

  it("handles monthly 2nd Saturday schedule", async () => {
    const source = makeSource({
      kennelTag: "TestKennel",
      rrule: "FREQ=MONTHLY;BYDAY=2SA",
    });
    const result = await adapter.fetch(source);

    // ~6 months → ~6 events
    expect(result.events.length).toBeGreaterThanOrEqual(5);
    expect(result.events.length).toBeLessThanOrEqual(7);

    // All should be Saturdays
    for (const event of result.events) {
      const date = new Date(event.date + "T12:00:00Z");
      expect(date.getUTCDay()).toBe(6);
      // Should be between 8th and 14th (2nd week)
      expect(date.getUTCDate()).toBeGreaterThanOrEqual(8);
      expect(date.getUTCDate()).toBeLessThanOrEqual(14);
    }
  });

  it("passes anchorDate through to generateOccurrences", async () => {
    const source = makeSource({
      kennelTag: "Rumson",
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      anchorDate: "2026-01-03",
    });
    const result = await adapter.fetch(source);

    expect(result.errors).toHaveLength(0);
    // All dates should be exactly 14-day multiples from anchor
    const anchorMs = new Date("2026-01-03T12:00:00Z").getTime();
    for (const event of result.events) {
      const dateMs = new Date(event.date + "T12:00:00Z").getTime();
      const daysDiff = Math.round((dateMs - anchorMs) / 86_400_000);
      expect(daysDiff % 14).toBe(0);
    }
  });
});
