import {
  StaticScheduleAdapter,
  parseRRule,
  generateOccurrences,
} from "./adapter";
import type { StaticScheduleConfig } from "./adapter";
import type { RawEventData } from "../types";
import type { Source } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Shared constants & helpers to reduce test duplication
// ---------------------------------------------------------------------------

const WEEKLY_SAT = "FREQ=WEEKLY;BYDAY=SA";
const BIWEEKLY_SAT = "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA";
const MONTHLY_2ND_SAT = "FREQ=MONTHLY;BYDAY=2SA";
const DEFAULT_URL = "https://www.facebook.com/groups/rumsonh3/";

function makeSource(config: Record<string, unknown>, url = DEFAULT_URL): Source {
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

/** Build a Rumson weekly-Saturday source with optional config overrides. */
function rumsonSource(overrides: Partial<StaticScheduleConfig> = {}, url = DEFAULT_URL): Source {
  return makeSource({ kennelTag: "Rumson", rrule: WEEKLY_SAT, ...overrides }, url);
}

/** Shorthand for `new Date(Date.UTC(...))` in test date ranges. */
function utcDate(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min, s));
}

/** Assert that every event has the given property value. */
function expectAllEvents(events: RawEventData[], prop: keyof RawEventData, value: unknown): void {
  for (const event of events) {
    expect(event[prop]).toBe(value);
  }
}

// ---------------------------------------------------------------------------
// parseRRule
// ---------------------------------------------------------------------------

describe("parseRRule", () => {
  it("parses weekly Saturday", () => {
    const rule = parseRRule(WEEKLY_SAT);
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.interval).toBe(1);
    expect(rule.byDay).toEqual({ day: 6 });
  });

  it("parses biweekly Saturday", () => {
    const rule = parseRRule(BIWEEKLY_SAT);
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.interval).toBe(2);
    expect(rule.byDay).toEqual({ day: 6 });
  });

  it("parses monthly 2nd Saturday", () => {
    const rule = parseRRule(MONTHLY_2ND_SAT);
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

  it.each([
    ["BYDAY=SA", "missing FREQ"],
    ["FREQ=WEEKLY;BYDAY=XX", "Unknown day"],
    ["FREQ=WEEKLY;INTERVAL=0;BYDAY=SA", "Invalid INTERVAL"],
    ["FREQ=WEEKLY;INTERVAL=-1;BYDAY=SA", "Invalid INTERVAL"],
    ["FREQ=MONTHLY;BYMONTHDAY=0", "Invalid BYMONTHDAY"],
    ["FREQ=MONTHLY;BYMONTHDAY=32", "Invalid BYMONTHDAY"],
    ["FREQ=MONTHLY;BYDAY=0SA", "nth position cannot be 0"],
    ["FREQ=DAILY;BYDAY=SA", "Unsupported FREQ"],
    ["FREQ=YEARLY;BYDAY=SA", "Unsupported FREQ"],
    ["FREQ=WEEKLY", "WEEKLY RRULE requires BYDAY"],
  ])("throws on invalid input: %s", (rrule, expectedError) => {
    expect(() => parseRRule(rrule)).toThrow(expectedError);
  });
});

// ---------------------------------------------------------------------------
// generateOccurrences
// ---------------------------------------------------------------------------

describe("generateOccurrences", () => {
  it("generates weekly Saturday dates", () => {
    const rule = parseRRule(WEEKLY_SAT);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 0, 31, 23, 59, 59));

    expect(dates).toEqual([
      "2026-01-03",
      "2026-01-10",
      "2026-01-17",
      "2026-01-24",
      "2026-01-31",
    ]);
  });

  it("generates biweekly Saturday dates", () => {
    const rule = parseRRule(BIWEEKLY_SAT);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 0, 31, 23, 59, 59));

    expect(dates.length).toBeLessThanOrEqual(3);
    for (const d of dates) {
      expect(new Date(d + "T12:00:00Z").getUTCDay()).toBe(6);
    }
  });

  it("generates stable biweekly dates with anchorDate", () => {
    const rule = parseRRule(BIWEEKLY_SAT);
    const anchor = "2026-01-03";

    const dates1 = generateOccurrences(rule, utcDate(2026, 0, 1, 12), utcDate(2026, 1, 28, 12), anchor);
    const dates2 = generateOccurrences(rule, utcDate(2026, 0, 10, 12), utcDate(2026, 2, 10, 12), anchor);

    const overlap = dates1.filter((d) => dates2.includes(d));
    expect(overlap.length).toBeGreaterThan(0);

    const anchorMs = new Date(anchor + "T12:00:00Z").getTime();
    for (const d of [...dates1, ...dates2]) {
      const daysDiff = Math.round((new Date(d + "T12:00:00Z").getTime() - anchorMs) / 86_400_000);
      expect(daysDiff % 14).toBe(0);
    }
  });

  it("generates monthly 2nd Saturday dates", () => {
    const rule = parseRRule(MONTHLY_2ND_SAT);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 5, 30, 23, 59, 59));

    expect(dates).toHaveLength(6);
    expect(dates[0]).toBe("2026-01-10");
    expect(dates[1]).toBe("2026-02-14");
  });

  it("generates monthly by day of month", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYMONTHDAY=15");
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 2, 31, 23, 59, 59));

    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("generates monthly last Friday", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=-1FR");
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 2, 31, 23, 59, 59));

    expect(dates).toHaveLength(3);
    for (const d of dates) {
      expect(new Date(d + "T12:00:00Z").getUTCDay()).toBe(5);
    }
  });

  it("returns empty array for window with no matching occurrences", () => {
    const rule = parseRRule(WEEKLY_SAT);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 5), utcDate(2026, 0, 9, 23, 59, 59));
    expect(dates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// StaticScheduleAdapter
// ---------------------------------------------------------------------------

describe("StaticScheduleAdapter", () => {
  const adapter = new StaticScheduleAdapter();

  // --- Error cases ---

  it("returns error for null config", async () => {
    const source = makeSource(null as never);
    source.config = null;
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("config");
  });

  it("returns error for missing kennelTag", async () => {
    const result = await adapter.fetch(makeSource({ rrule: WEEKLY_SAT }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("kennelTag");
  });

  it("returns error for missing rrule", async () => {
    const result = await adapter.fetch(makeSource({ kennelTag: "Rumson" }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("rrule");
  });

  it("returns error for invalid rrule syntax", async () => {
    const result = await adapter.fetch(makeSource({ kennelTag: "Rumson", rrule: "NOTAFREQ=WEEKLY;BYDAY=SA" }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("RRULE");
  });

  it("returns error for unsupported FREQ", async () => {
    const result = await adapter.fetch(makeSource({ kennelTag: "Rumson", rrule: "FREQ=DAILY;BYDAY=SA" }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("Unsupported FREQ");
  });

  // --- Tests that share the base Rumson weekly source ---

  describe("weekly Saturday base behavior", () => {
    let result: Awaited<ReturnType<StaticScheduleAdapter["fetch"]>>;

    beforeEach(async () => {
      result = await adapter.fetch(rumsonSource());
    });

    it("generates events within default 90-day window", () => {
      expect(result.errors).toHaveLength(0);
      expect(result.events.length).toBeGreaterThanOrEqual(24);
      expect(result.events.length).toBeLessThanOrEqual(27);
    });

    it("assigns kennelTag to all events", () => {
      expectAllEvents(result.events, "kennelTag", "Rumson");
    });

    it("omits startTime when not configured", () => {
      expectAllEvents(result.events, "startTime", undefined);
    });

    it("generates YYYY-MM-DD date strings", () => {
      for (const event of result.events) {
        expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("includes diagnosticContext with rrule and occurrence count", () => {
      expect(result.diagnosticContext).toBeDefined();
      expect(result.diagnosticContext!.rrule).toBe(WEEKLY_SAT);
      expect(result.diagnosticContext!.occurrencesGenerated).toBe(result.events.length);
      expect(result.diagnosticContext!.windowDays).toBe(90);
    });

    it("generates all Saturdays as day-of-week 6", () => {
      for (const event of result.events) {
        expect(new Date(event.date + "T12:00:00Z").getUTCDay()).toBe(6);
      }
    });
  });

  it("sets sourceUrl to source.url", async () => {
    const fbUrl = "https://www.facebook.com/p/Rumson-H3-100063637060523/";
    const result = await adapter.fetch(rumsonSource({}, fbUrl));
    expectAllEvents(result.events, "sourceUrl", fbUrl);
  });

  it("accepts 24-hour startTime HH:MM", async () => {
    const result = await adapter.fetch(rumsonSource({ startTime: "10:17" }));
    expect(result.events.length).toBeGreaterThan(0);
    expectAllEvents(result.events, "startTime", "10:17");
  });

  it("rejects non-HH:MM startTime (returns undefined)", async () => {
    const result = await adapter.fetch(rumsonSource({ startTime: "10:17 AM" }));
    expectAllEvents(result.events, "startTime", undefined);
  });

  it("populates defaultTitle on all events", async () => {
    const result = await adapter.fetch(rumsonSource({ defaultTitle: "Rumson H3 Weekly Run" }));
    expectAllEvents(result.events, "title", "Rumson H3 Weekly Run");
  });

  it("populates defaultLocation on all events", async () => {
    const result = await adapter.fetch(rumsonSource({ defaultLocation: "Rumson, NJ" }));
    expectAllEvents(result.events, "location", "Rumson, NJ");
  });

  it("populates defaultDescription on all events", async () => {
    const result = await adapter.fetch(rumsonSource({ defaultDescription: "Check Facebook" }));
    expectAllEvents(result.events, "description", "Check Facebook");
  });

  it("respects custom days option", async () => {
    const result = await adapter.fetch(rumsonSource(), { days: 14 });
    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.events.length).toBeLessThanOrEqual(5);
  });

  it("handles biweekly schedule", async () => {
    const weeklyResult = await adapter.fetch(makeSource({ kennelTag: "TestKennel", rrule: WEEKLY_SAT }));
    const biweeklyResult = await adapter.fetch(makeSource({ kennelTag: "TestKennel", rrule: BIWEEKLY_SAT }));

    expect(biweeklyResult.events.length).toBeLessThan(weeklyResult.events.length);
    expect(biweeklyResult.events.length).toBeGreaterThanOrEqual(
      Math.floor(weeklyResult.events.length / 2) - 1,
    );
  });

  it("handles monthly 2nd Saturday schedule", async () => {
    const result = await adapter.fetch(makeSource({ kennelTag: "TestKennel", rrule: MONTHLY_2ND_SAT }));

    expect(result.events.length).toBeGreaterThanOrEqual(5);
    expect(result.events.length).toBeLessThanOrEqual(7);

    for (const event of result.events) {
      const date = new Date(event.date + "T12:00:00Z");
      expect(date.getUTCDay()).toBe(6);
      expect(date.getUTCDate()).toBeGreaterThanOrEqual(8);
      expect(date.getUTCDate()).toBeLessThanOrEqual(14);
    }
  });

  it("passes anchorDate through to generateOccurrences", async () => {
    const result = await adapter.fetch(rumsonSource({ rrule: BIWEEKLY_SAT, anchorDate: "2026-01-03" }));

    expect(result.errors).toHaveLength(0);
    const anchorMs = new Date("2026-01-03T12:00:00Z").getTime();
    for (const event of result.events) {
      const daysDiff = Math.abs(Math.round((new Date(event.date + "T12:00:00Z").getTime() - anchorMs) / 86_400_000));
      expect(daysDiff % 14).toBe(0);
    }
  });
});
