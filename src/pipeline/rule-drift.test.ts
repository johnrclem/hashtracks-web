import { dominantWeekday, judgeDrift, weekdayName } from "./rule-drift";

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
