import { describe, it, expect } from "vitest";
import {
  getDayCode,
  computeDayCounts,
  passesDayFilter,
  groupResultsByTier,
  toggleDay,
  type DayCode,
  type DistanceTier,
} from "./filters";

// UTC noon on various 2026 weekdays (matches the UTC-noon convention
// used throughout Travel Mode)
const SUN_APR_12 = "2026-04-12T12:00:00.000Z";
const MON_APR_13 = "2026-04-13T12:00:00.000Z";
const TUE_APR_14 = "2026-04-14T12:00:00.000Z";
const WED_APR_15 = "2026-04-15T12:00:00.000Z";
const SAT_APR_18 = "2026-04-18T12:00:00.000Z";

function makeConfirmed(overrides: {
  eventId: string;
  date: string;
  distanceTier: DistanceTier;
}) {
  return {
    eventId: overrides.eventId,
    date: overrides.date,
    distanceTier: overrides.distanceTier,
    kennelId: `k-${overrides.eventId}`,
  };
}

function makeLikely(overrides: {
  kennelId: string;
  date: string;
  distanceTier: DistanceTier;
}) {
  return {
    kennelId: overrides.kennelId,
    date: overrides.date,
    distanceTier: overrides.distanceTier,
  };
}

function makePossible(overrides: {
  kennelId: string;
  date: string | null;
  distanceTier: DistanceTier;
}) {
  return {
    kennelId: overrides.kennelId,
    date: overrides.date,
    distanceTier: overrides.distanceTier,
  };
}

describe("getDayCode", () => {
  it("maps UTC-noon ISO dates to abbreviated day codes", () => {
    expect(getDayCode(SUN_APR_12)).toBe("Sun");
    expect(getDayCode(MON_APR_13)).toBe("Mon");
    expect(getDayCode(TUE_APR_14)).toBe("Tue");
    expect(getDayCode(WED_APR_15)).toBe("Wed");
    expect(getDayCode(SAT_APR_18)).toBe("Sat");
  });

  it("uses UTC day so midnight-adjacent dates don't shift for westward TZs", () => {
    // 2026-04-13 23:59 UTC is still Monday in UTC, though it's already
    // Tuesday in most Asia/Pacific zones. The app stores UTC-noon, but
    // defensively: even a late-UTC hour should read UTC-day.
    expect(getDayCode("2026-04-13T23:59:00.000Z")).toBe("Mon");
  });
});

describe("passesDayFilter", () => {
  it("passes everything when selectedDays is empty", () => {
    expect(passesDayFilter("Mon", new Set())).toBe(true);
    expect(passesDayFilter("Sat", new Set())).toBe(true);
    expect(passesDayFilter(null, new Set())).toBe(true);
  });

  it("filters by DOW membership when selectedDays is non-empty", () => {
    const filter = new Set<DayCode>(["Sat", "Sun"]);
    expect(passesDayFilter("Sat", filter)).toBe(true);
    expect(passesDayFilter("Sun", filter)).toBe(true);
    expect(passesDayFilter("Mon", filter)).toBe(false);
    expect(passesDayFilter("Wed", filter)).toBe(false);
  });

  it("lets null-date (cadence-based) results through even when a day filter is active", () => {
    const filter = new Set<DayCode>(["Sat"]);
    expect(passesDayFilter(null, filter)).toBe(true);
  });
});

describe("computeDayCounts", () => {
  it("returns empty structure when no results", () => {
    const { availableDays, dayCounts } = computeDayCounts([], []);
    expect(availableDays.size).toBe(0);
    expect(Object.keys(dayCounts)).toHaveLength(0);
  });

  it("counts confirmed + likely together", () => {
    const confirmed = [{ date: SAT_APR_18 }, { date: SAT_APR_18 }];
    const likely = [{ date: SAT_APR_18 }, { date: MON_APR_13 }];
    const { availableDays, dayCounts } = computeDayCounts(confirmed, likely);
    expect(availableDays).toEqual(new Set(["Sat", "Mon"]));
    expect(dayCounts.Sat).toBe(3);
    expect(dayCounts.Mon).toBe(1);
  });

  it("includes dated possibles so their days are chip-selectable", () => {
    // Regression: previously chips only reflected confirmed+likely, but the
    // day filter was applied to dated possibles too — users couldn't isolate
    // days that had only low-confidence dated results.
    const { availableDays, dayCounts } = computeDayCounts(
      [{ date: SAT_APR_18 }],
      [],
      [{ date: TUE_APR_14 }, { date: TUE_APR_14 }, { date: null }],
    );
    expect(availableDays).toEqual(new Set(["Sat", "Tue"]));
    expect(dayCounts.Sat).toBe(1);
    expect(dayCounts.Tue).toBe(2);
  });

  it("omits cadence-based (date=null) possibles — they have no concrete DOW", () => {
    const { availableDays } = computeDayCounts(
      [],
      [],
      [{ date: null }, { date: null }],
    );
    expect(availableDays.size).toBe(0);
  });
});

describe("groupResultsByTier", () => {
  it("buckets by distanceTier with no filter", () => {
    const out = groupResultsByTier({
      confirmed: [
        makeConfirmed({ eventId: "e1", date: SAT_APR_18, distanceTier: "nearby" }),
        makeConfirmed({ eventId: "e2", date: SAT_APR_18, distanceTier: "area" }),
      ],
      likely: [
        makeLikely({ kennelId: "k1", date: SAT_APR_18, distanceTier: "drive" }),
      ],
      possible: [
        makePossible({ kennelId: "k2", date: null, distanceTier: "area" }),
      ],
      selectedDays: new Set(),
    });

    expect(out.nearby.confirmed).toHaveLength(1);
    expect(out.area.confirmed).toHaveLength(1);
    expect(out.drive.likely).toHaveLength(1);
    expect(out.area.possible).toHaveLength(1);
  });

  it("drops non-matching days from confirmed + likely when a day filter is active", () => {
    const out = groupResultsByTier({
      confirmed: [
        makeConfirmed({ eventId: "e-sat", date: SAT_APR_18, distanceTier: "nearby" }),
        makeConfirmed({ eventId: "e-mon", date: MON_APR_13, distanceTier: "nearby" }),
      ],
      likely: [
        makeLikely({ kennelId: "k-tue", date: TUE_APR_14, distanceTier: "nearby" }),
      ],
      possible: [],
      selectedDays: new Set<DayCode>(["Sat"]),
    });

    expect(out.nearby.confirmed.map((r) => r.eventId)).toEqual(["e-sat"]);
    expect(out.nearby.likely).toHaveLength(0);
  });

  it("keeps cadence-based possibles (date=null) under any day filter", () => {
    const out = groupResultsByTier({
      confirmed: [],
      likely: [],
      possible: [
        makePossible({ kennelId: "k-cadence", date: null, distanceTier: "nearby" }),
        makePossible({ kennelId: "k-dated-mon", date: MON_APR_13, distanceTier: "nearby" }),
        makePossible({ kennelId: "k-dated-sat", date: SAT_APR_18, distanceTier: "nearby" }),
      ],
      selectedDays: new Set<DayCode>(["Sat"]),
    });

    const kept = out.nearby.possible.map((r) => r.kennelId).sort();
    expect(kept).toEqual(["k-cadence", "k-dated-sat"]);
  });

  it("preserves multiple possibles from the same kennel in the same tier", () => {
    // Regression: a kennel with multiple LOW rules (e.g. dated monthly +
    // cadence-based lunar) can produce several PossibleResults with the
    // same kennelId in one tier. The grouper must keep all of them.
    const out = groupResultsByTier({
      confirmed: [],
      likely: [],
      possible: [
        makePossible({ kennelId: "k-dup", date: SAT_APR_18, distanceTier: "nearby" }),
        makePossible({ kennelId: "k-dup", date: TUE_APR_14, distanceTier: "nearby" }),
        makePossible({ kennelId: "k-dup", date: null, distanceTier: "nearby" }),
      ],
      selectedDays: new Set(),
    });
    expect(out.nearby.possible).toHaveLength(3);
  });

  it("preserves source order within a tier", () => {
    const out = groupResultsByTier({
      confirmed: [
        makeConfirmed({ eventId: "e1", date: SAT_APR_18, distanceTier: "nearby" }),
        makeConfirmed({ eventId: "e2", date: SAT_APR_18, distanceTier: "nearby" }),
        makeConfirmed({ eventId: "e3", date: SAT_APR_18, distanceTier: "nearby" }),
      ],
      likely: [],
      possible: [],
      selectedDays: new Set(),
    });
    expect(out.nearby.confirmed.map((r) => r.eventId)).toEqual(["e1", "e2", "e3"]);
  });

  it("returns empty tier buckets when all inputs are filtered out", () => {
    const out = groupResultsByTier({
      confirmed: [
        makeConfirmed({ eventId: "e1", date: MON_APR_13, distanceTier: "nearby" }),
      ],
      likely: [],
      possible: [],
      selectedDays: new Set<DayCode>(["Sat"]),
    });
    expect(out.nearby.confirmed).toHaveLength(0);
    expect(out.area.confirmed).toHaveLength(0);
    expect(out.drive.confirmed).toHaveLength(0);
  });
});

describe("toggleDay", () => {
  it("adds a day when not present", () => {
    const next = toggleDay(new Set(), "Sat");
    expect(next.has("Sat")).toBe(true);
    expect(next.size).toBe(1);
  });

  it("removes a day when present", () => {
    const next = toggleDay(new Set<DayCode>(["Sat", "Sun"]), "Sat");
    expect(next.has("Sat")).toBe(false);
    expect(next.has("Sun")).toBe(true);
  });

  it("returns a new Set instance (immutable)", () => {
    const prev = new Set<DayCode>(["Sat"]);
    const next = toggleDay(prev, "Sun");
    expect(next).not.toBe(prev);
    expect(prev.has("Sun")).toBe(false);
    expect(next.has("Sun")).toBe(true);
  });
});
