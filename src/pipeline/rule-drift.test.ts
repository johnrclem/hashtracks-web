import { detectRuleDrift, dominantWeekday, judgeDrift, sentinelWeekdays, weekdayName } from "./rule-drift";

// UTC-noon dates on known weekdays. 2026-06-01 is a Monday.
const MON = "2026-06-01"; // Mon
const TUE = "2026-06-02";
const WED = "2026-06-03";
const SAT = "2026-06-06"; // Sat
const d = (iso: string) => new Date(iso + "T12:00:00Z");

// Guard: every test below assumes these calendar weekdays. Fail fast if a constant is edited.
describe("fixture sanity", () => {
  it("date constants fall on their labelled weekdays", () => {
    expect(d(MON).getUTCDay()).toBe(1);
    expect(d(TUE).getUTCDay()).toBe(2);
    expect(d(WED).getUTCDay()).toBe(3);
    expect(d(SAT).getUTCDay()).toBe(6);
  });
});

describe("dominantWeekday", () => {
  it("finds the most common weekday + share", () => {
    const r = dominantWeekday([d(SAT), d(SAT), d(SAT), d(MON)]);
    expect(weekdayName(r.day)).toBe("Sat");
    expect(r.count).toBe(4);
    expect(r.share).toBeCloseTo(0.75);
  });
  it("returns day -1 for an empty set", () => {
    expect(dominantWeekday([]).day).toBe(-1);
  });
});

describe("judgeDrift", () => {
  const recentSat = [d(SAT), d(SAT), d(SAT), d(SAT), d(SAT)]; // clear Saturday

  it("flags drift when reality (Sat) is not among the predicted weekdays (Mon)", () => {
    const r = judgeDrift(new Set([1 /* Mon */]), recentSat);
    expect(r).not.toBeNull();
    expect(weekdayName(r!.actualDay)).toBe("Sat");
  });

  it("does NOT flag when the rule already predicts the recent weekday (Sat)", () => {
    expect(judgeDrift(new Set([6 /* Sat */]), recentSat)).toBeNull();
  });

  it("does NOT flag a correctly multi-day rule (predicts Sat AND Mon)", () => {
    expect(judgeDrift(new Set([6, 1]), recentSat)).toBeNull();
  });

  it("does NOT flag with too few recent events", () => {
    expect(judgeDrift(new Set([1]), [d(SAT), d(SAT)])).toBeNull();
  });

  it("does NOT flag when recent events are scattered (no clear dominant day)", () => {
    expect(judgeDrift(new Set([1]), [d(SAT), d(MON), d(TUE), d(WED)])).toBeNull();
  });

  it("does NOT flag when the rule projects nothing in the window (empty predicted set)", () => {
    expect(judgeDrift(new Set<number>(), recentSat)).toBeNull();
  });
});

describe("sentinelWeekdays", () => {
  it("reads the weekday from a CADENCE sentinel", () => {
    expect(sentinelWeekdays("CADENCE=WEEKLY;BYDAY=SU")).toEqual([0]);
    expect(sentinelWeekdays("CADENCE=BIWEEKLY;BYDAY=TH")).toEqual([4]);
  });
  it("reads multiple weekdays", () => {
    expect(sentinelWeekdays("CADENCE=MONTHLY;BYDAY=SA,SU")).toEqual([6, 0]);
  });
  it("ignores dated FREQ rules, LUNAR sentinels and junk tokens", () => {
    expect(sentinelWeekdays("FREQ=WEEKLY;BYDAY=MO")).toEqual([]);
    expect(sentinelWeekdays("FREQ=LUNAR;BYMOONPHASE=FULL")).toEqual([]);
    expect(sentinelWeekdays("CADENCE=WEEKLY")).toEqual([]);
    expect(sentinelWeekdays("CADENCE=WEEKLY;BYDAY=XX")).toEqual([]);
  });
});

describe("detectRuleDrift — LOW cadence sentinel suppression (#2454)", () => {
  // 2026-11-02 is a Monday. Recent window: 4 Sundays + 1 Monday (Desert H3 cool-season shape).
  const now = new Date("2026-11-03T12:00:00Z");
  const ev = (iso: string) => ({
    kennelId: "k1",
    date: d(iso),
    eventKennels: [],
    rawEvents: [{ source: { type: "HTML_SCRAPER" } }],
  });
  const events = ["2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01", "2026-10-26"].map(ev);
  const kennel = { id: "k1", kennelCode: "dh3-ae", shortName: "Desert H3", region: "Dubai" };
  const rule = (id: string, rrule: string, confidence: "MEDIUM" | "LOW") => ({
    id, kennelId: "k1", rrule, anchorDate: null, startTime: "19:00", confidence,
    notes: null, label: null, validFrom: null, validUntil: null,
  });
  const mockPrisma = (rules: ReturnType<typeof rule>[]) =>
    ({
      kennel: { findMany: vi.fn().mockResolvedValue([kennel]) },
      scheduleRule: { findMany: vi.fn().mockResolvedValue(rules) },
      event: { findMany: vi.fn().mockResolvedValue(events) },
    }) as never;

  it("flags Sunday reality against a Monday-only rule", async () => {
    const findings = await detectRuleDrift(mockPrisma([rule("r1", "FREQ=WEEKLY;BYDAY=MO", "MEDIUM")]), now);
    expect(findings.map((f) => f.kennelCode)).toEqual(["dh3-ae"]);
    expect(findings[0].actualWeekday).toBe("Sun");
  });

  it("does NOT flag when a LOW CADENCE sentinel declares the Sunday slot", async () => {
    const findings = await detectRuleDrift(
      mockPrisma([rule("r1", "FREQ=WEEKLY;BYDAY=MO", "MEDIUM"), rule("r2", "CADENCE=WEEKLY;BYDAY=SU", "LOW")]),
      now,
    );
    expect(findings).toEqual([]);
  });

  it("still flags when the sentinel names a different weekday", async () => {
    const findings = await detectRuleDrift(
      mockPrisma([rule("r1", "FREQ=WEEKLY;BYDAY=MO", "MEDIUM"), rule("r2", "CADENCE=WEEKLY;BYDAY=SA", "LOW")]),
      now,
    );
    expect(findings.map((f) => f.kennelCode)).toEqual(["dh3-ae"]);
  });
});
