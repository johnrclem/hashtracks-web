import {
  StaticScheduleAdapter,
  parseRRule,
  generateOccurrences,
  renderTitleTemplate,
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
const NOSE_SUMMER = "FREQ=WEEKLY;BYDAY=TH;BYMONTH=5,6,7,8,9,10";
const NOSE_WINTER = "FREQ=WEEKLY;BYDAY=WE;BYMONTH=1,2,3,4,11,12";
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

/** Assert that every event has the given property value (deep equality for arrays/objects). */
function expectAllEvents(events: RawEventData[], prop: keyof RawEventData, value: unknown): void {
  for (const event of events) {
    expect(event[prop]).toEqual(value);
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

  it("parses BYMONTH list (NOSE summer)", () => {
    const rule = parseRRule(NOSE_SUMMER);
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.byDay).toEqual({ day: 4 });
    expect(rule.byMonth).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("dedupes and sorts BYMONTH values", () => {
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=TH;BYMONTH=10,5,5,6,9,7,8");
    expect(rule.byMonth).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("tolerates whitespace inside BYMONTH list", () => {
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=TH;BYMONTH=5, 6 , 7");
    expect(rule.byMonth).toEqual([5, 6, 7]);
  });

  it("leaves byMonth undefined when BYMONTH is absent", () => {
    const rule = parseRRule(WEEKLY_SAT);
    expect(rule.byMonth).toBeUndefined();
  });

  it("accepts RFC 5545 1*2DIGIT month forms (leading zero)", () => {
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=TH;BYMONTH=05,06,07,08,09,10");
    expect(rule.byMonth).toEqual([5, 6, 7, 8, 9, 10]);
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
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=0", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=13", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=foo", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=5.5", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=,", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=5,,6", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=5,", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=,5", "Invalid BYMONTH"],
    ["FREQ=WEEKLY;BYDAY=TH;BYMONTH=005", "Invalid BYMONTH"],
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

  it("filters to BYMONTH months for NOSE summer (May-Oct Thursdays)", () => {
    const rule = parseRRule(NOSE_SUMMER);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 11, 31, 23, 59, 59));

    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0]).toBe("2026-05-07"); // first Thursday of May 2026
    expect(dates.at(-1)).toBe("2026-10-29"); // last Thursday of October 2026
    for (const d of dates) {
      const date = new Date(d + "T12:00:00Z");
      expect(date.getUTCDay()).toBe(4); // Thursday
      const month = date.getUTCMonth() + 1;
      expect(month).toBeGreaterThanOrEqual(5);
      expect(month).toBeLessThanOrEqual(10);
    }
  });

  it("filters to BYMONTH months for NOSE winter (Nov-Apr Wednesdays)", () => {
    const rule = parseRRule(NOSE_WINTER);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 11, 31, 23, 59, 59));

    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) {
      const date = new Date(d + "T12:00:00Z");
      expect(date.getUTCDay()).toBe(3); // Wednesday
      const month = date.getUTCMonth() + 1;
      expect([1, 2, 3, 4, 11, 12]).toContain(month);
    }
  });

  it("emits unchanged output when BYMONTH is absent (non-breaking)", () => {
    const rule = parseRRule(WEEKLY_SAT);
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2026, 11, 31, 23, 59, 59));

    const monthsCovered = new Set(dates.map((d) => Number.parseInt(d.slice(5, 7), 10)));
    for (let m = 1; m <= 12; m++) {
      expect(monthsCovered.has(m)).toBe(true);
    }
  });

  it("supports BYMONTH on monthly rules (annual occurrence pattern)", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYMONTHDAY=15;BYMONTH=6");
    const dates = generateOccurrences(rule, utcDate(2026, 0, 1), utcDate(2027, 11, 31, 23, 59, 59));
    expect(dates).toEqual(["2026-06-15", "2027-06-15"]);
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
      expectAllEvents(result.events, "kennelTags", ["Rumson"]);
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

  it("filters fetched events to BYMONTH months", async () => {
    const result = await adapter.fetch(
      makeSource({ kennelTag: "NOSEH3", rrule: NOSE_SUMMER }),
      { days: 365 },
    );

    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      const month = Number.parseInt(event.date.slice(5, 7), 10);
      expect([5, 6, 7, 8, 9, 10]).toContain(month);
      expect(new Date(event.date + "T12:00:00Z").getUTCDay()).toBe(4); // Thursday
    }
  });

  it("treats off-season as success (no error) when window misses every BYMONTH month", async () => {
    // Single-month June rule scraped in mid-December: 90-day window spans
    // mid-Sep → mid-Mar, never touching June. Should return 0 events with NO
    // error so the alert pipeline doesn't fire 6+ months of false alarms.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
    try {
      const result = await adapter.fetch(
        makeSource({ kennelTag: "TestKennel", rrule: "FREQ=MONTHLY;BYMONTHDAY=15;BYMONTH=6" }),
      );
      expect(result.errors).toHaveLength(0);
      expect(result.events).toHaveLength(0);
      expect(result.diagnosticContext?.note).toMatch(/off-season/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still alerts when window overlaps a BYMONTH month but generates 0 events", async () => {
    // Window crosses June, but BYMONTHDAY=31 in June clamps to June 30 — wait,
    // that still emits. Use BYDAY=2SA;BYMONTH=6 in a window that contains June
    // and ensure the day-2-Saturday-of-June logic emits at least one event.
    // To force a true 0-with-overlap, use an invalid pairing: monthly nth weekday
    // that resolves outside the month — which the existing nthWeekdayOfMonth
    // returns null for. But simpler: use a 1-day window starting today that
    // overlaps a BYMONTH month but lands on a non-target weekday.
    vi.useFakeTimers();
    // Set "today" to Mon 2026-06-15 (June, in BYMONTH=6) and use a 0-day window:
    // window = [today-0, today+0] = exactly today. Rule wants Saturdays in June.
    // Today is Monday → 0 events, but window IS in June → real misconfig signal.
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    try {
      const result = await adapter.fetch(
        makeSource({ kennelTag: "TestKennel", rrule: "FREQ=WEEKLY;BYDAY=SA;BYMONTH=6" }),
        { days: 0 },
      );
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/0 events/);
    } finally {
      vi.useRealTimers();
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

// ---------------------------------------------------------------------------
// renderTitleTemplate
// ---------------------------------------------------------------------------

describe("renderTitleTemplate", () => {
  // Anchor: 2026-05-03 is a Sunday in May.
  it("renders {dayName}", () => {
    expect(renderTitleTemplate("Hash on {dayName}", "2026-05-03")).toBe("Hash on Sunday");
  });

  it("renders {monthName}", () => {
    expect(renderTitleTemplate("Run in {monthName}", "2026-05-03")).toBe("Run in May");
  });

  it("renders {date} as month + day-of-month without leading zero", () => {
    expect(renderTitleTemplate("CVH3 — {date} Hash", "2026-05-03")).toBe("CVH3 — May 3 Hash");
    expect(renderTitleTemplate("CVH3 — {date} Hash", "2026-05-23")).toBe("CVH3 — May 23 Hash");
  });

  it("renders {iso} as the input date string", () => {
    expect(renderTitleTemplate("[{iso}] Hash", "2026-05-03")).toBe("[2026-05-03] Hash");
  });

  it("renders multiple tokens in one template", () => {
    expect(renderTitleTemplate("DST — {date} ({dayName}) Hash", "2026-05-12")).toBe(
      "DST — May 12 (Tuesday) Hash",
    );
  });

  it("leaves unknown tokens literal", () => {
    expect(renderTitleTemplate("Hash {frobnitz} {date}", "2026-05-03")).toBe("Hash {frobnitz} May 3");
  });

  it("leaves a literal template unchanged when no tokens are present", () => {
    expect(renderTitleTemplate("ColH3 — 1st Sunday Hash", "2026-05-03")).toBe("ColH3 — 1st Sunday Hash");
  });

  it("returns the template untouched on malformed dates (defensive)", () => {
    expect(renderTitleTemplate("{date}", "not-a-date")).toBe("{date}");
  });
});

// ---------------------------------------------------------------------------
// StaticScheduleAdapter — titleTemplate end-to-end
// ---------------------------------------------------------------------------

describe("StaticScheduleAdapter titleTemplate", () => {
  const adapter = new StaticScheduleAdapter();

  it("renders titleTemplate per occurrence", async () => {
    const result = await adapter.fetch(rumsonSource({ titleTemplate: "Rumson — {date} Hash" }));
    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(event.title).toMatch(/^Rumson — [A-Z][a-z]+ \d{1,2} Hash$/);
    }
  });

  it("falls back to defaultTitle when titleTemplate is absent", async () => {
    const result = await adapter.fetch(rumsonSource({ defaultTitle: "Rumson H3 Weekly Run" }));
    expectAllEvents(result.events, "title", "Rumson H3 Weekly Run");
  });

  it("titleTemplate wins when both fields are set", async () => {
    const result = await adapter.fetch(
      rumsonSource({
        defaultTitle: "Rumson H3 Weekly Run",
        titleTemplate: "Rumson — {dayName} Hash",
      }),
    );
    for (const event of result.events) {
      expect(event.title).toBe("Rumson — Saturday Hash");
    }
  });

  it("treats empty titleTemplate as absent", async () => {
    const result = await adapter.fetch(
      rumsonSource({ defaultTitle: "Rumson H3 Weekly Run", titleTemplate: "" }),
    );
    expectAllEvents(result.events, "title", "Rumson H3 Weekly Run");
  });

  it("treats whitespace-only titleTemplate as absent", async () => {
    const result = await adapter.fetch(
      rumsonSource({ defaultTitle: "Rumson H3 Weekly Run", titleTemplate: "   " }),
    );
    expectAllEvents(result.events, "title", "Rumson H3 Weekly Run");
  });

  it("falls back to defaultTitle when titleTemplate is a non-string (admin payload corruption)", async () => {
    // Cast through unknown to simulate a malformed JSON payload reaching the adapter.
    const result = await adapter.fetch(
      rumsonSource({
        defaultTitle: "Rumson H3 Weekly Run",
        titleTemplate: [] as unknown as string,
      }),
    );
    expect(result.errors).toHaveLength(0);
    expectAllEvents(result.events, "title", "Rumson H3 Weekly Run");
  });

  it("leaves unknown tokens literal in the rendered title", async () => {
    const result = await adapter.fetch(rumsonSource({ titleTemplate: "Rumson {frobnitz} on {dayName}" }));
    for (const event of result.events) {
      expect(event.title).toBe("Rumson {frobnitz} on Saturday");
    }
  });
});

// ---------------------------------------------------------------------------
// Lunar mode (XOR with rrule)
// ---------------------------------------------------------------------------

describe("StaticScheduleAdapter lunar mode", () => {
  const adapter = new StaticScheduleAdapter();

  it("rejects config with neither rrule nor lunar", async () => {
    const source = makeSource({ kennelTag: "FMH3" });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/rrule.*lunar|lunar.*rrule/);
  });

  it("rejects config with both rrule and lunar (XOR)", async () => {
    const source = makeSource({
      kennelTag: "FMH3",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      lunar: { phase: "full", timezone: "America/Los_Angeles" },
    });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/cannot specify both/i);
  });

  it("rejects lunar without timezone", async () => {
    const source = makeSource({
      kennelTag: "FMH3",
      lunar: { phase: "full" },
    });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("timezone");
  });

  it("rejects lunar with invalid phase", async () => {
    const source = makeSource({
      kennelTag: "FMH3",
      lunar: { phase: "quarter", timezone: "UTC" },
    });
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("phase");
  });

  it("rejects anchorWeekday without anchorRule (and vice versa)", async () => {
    const a = await adapter.fetch(makeSource({
      kennelTag: "FMH3",
      lunar: { phase: "full", timezone: "UTC", anchorWeekday: "SA" },
    }));
    expect(a.errors[0]).toMatch(/anchor/);
    const b = await adapter.fetch(makeSource({
      kennelTag: "FMH3",
      lunar: { phase: "full", timezone: "UTC", anchorRule: "nearest" },
    }));
    expect(b.errors[0]).toMatch(/anchor/);
  });

  it("rejects an invalid IANA timezone (Codex pass-3: typos must not silently fall back to UTC)", async () => {
    const result = await adapter.fetch(makeSource({
      kennelTag: "FMH3",
      lunar: { phase: "full", timezone: "America/Los_Angles" }, // typo
    }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/not a recognized IANA timezone/);
  });

  it("rejects an invalid anchorWeekday value (Codex pass-3: enum check needed)", async () => {
    const result = await adapter.fetch(makeSource({
      kennelTag: "FMH3",
      lunar: {
        phase: "full",
        timezone: "America/Los_Angeles",
        anchorWeekday: "BOGUS",
        anchorRule: "nearest",
      },
    }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/anchorWeekday/);
  });

  it("rejects an invalid anchorRule value (Codex pass-3: enum check needed)", async () => {
    const result = await adapter.fetch(makeSource({
      kennelTag: "FMH3",
      lunar: {
        phase: "full",
        timezone: "America/Los_Angeles",
        anchorWeekday: "SA",
        anchorRule: "whenever",
      },
    }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/anchorRule/);
  });

  it("generates lunar full-moon events for an FMH3 SF style config", async () => {
    const source = makeSource({
      kennelTag: "fmh3-sf",
      lunar: { phase: "full", timezone: "America/Los_Angeles" },
      defaultTitle: "FMH3 SF Full Moon Run",
      defaultLocation: "San Francisco",
    });
    // ±365 day window centered on now → expect ~25 full moons (one per ~29.5 days).
    const result = await adapter.fetch(source, { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBeGreaterThanOrEqual(20);
    expect(result.events.length).toBeLessThanOrEqual(28);
    expect(result.events[0].kennelTags).toEqual(["fmh3-sf"]);
    expect(result.events[0].title).toBe("FMH3 SF Full Moon Run");
    expect(result.events[0].location).toBe("San Francisco");
    // diagnosticContext should reflect lunar mode, not rrule.
    expect(result.diagnosticContext?.mode).toBe("lunar");
    expect(result.diagnosticContext?.phase).toBe("full");
  });

  it("generates anchor-mode events for a DCFMH3 style config (Saturday near full moon)", async () => {
    const source = makeSource({
      kennelTag: "dcfmh3",
      lunar: {
        phase: "full",
        timezone: "America/New_York",
        anchorWeekday: "SA",
        anchorRule: "nearest",
      },
      defaultTitle: "DCFMH3 Full Moon Hash",
    });
    const result = await adapter.fetch(source, { days: 90 });
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBeGreaterThanOrEqual(2);
    // Every event should land on a Saturday (UTC-day 6, since dates are stored UTC noon).
    for (const event of result.events) {
      const d = new Date(event.date + "T12:00:00Z");
      expect(d.getUTCDay()).toBe(6);
    }
  });

  it("respects options.days for lunar mode (smaller window → fewer events)", async () => {
    const source = makeSource({
      kennelTag: "fmh3-sf",
      lunar: { phase: "full", timezone: "America/Los_Angeles" },
    });
    const small = await adapter.fetch(source, { days: 30 });
    const large = await adapter.fetch(source, { days: 365 });
    // 30-day window: 1 or 2 full moons; 365-day window: ~25.
    expect(small.events.length).toBeLessThanOrEqual(3);
    expect(large.events.length).toBeGreaterThan(small.events.length);
  });

  it("emits dates as YYYY-MM-DD UTC-noon strings (matches RRULE-mode convention)", async () => {
    const source = makeSource({
      kennelTag: "fmh3-sf",
      lunar: { phase: "full", timezone: "America/Los_Angeles" },
    });
    const result = await adapter.fetch(source, { days: 365 });
    for (const event of result.events) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
