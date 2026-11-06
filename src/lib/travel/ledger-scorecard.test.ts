import {
  binOf,
  buildPrecisionMap,
  tallyOutcomes,
  firstMaturityDate,
  shapeLeadTimeGrid,
  unobservedReason,
  type ScorecardSnap,
  type UnobservedKennelRow,
} from "./ledger-scorecard";

const snap = (o: Partial<ScorecardSnap>): ScorecardSnap => ({
  confidence: "HIGH",
  daysOutAtSnapshot: 30,
  outcome: "PENDING",
  ...o,
});

describe("binOf", () => {
  it("maps days-out to the named bins, with a 200+ catch-all", () => {
    expect(binOf(0)).toBe("0–45");
    expect(binOf(45)).toBe("0–45");
    expect(binOf(46)).toBe("46–120");
    expect(binOf(120)).toBe("46–120");
    expect(binOf(121)).toBe("121–200");
    expect(binOf(200)).toBe("121–200");
    expect(binOf(201)).toBe("200+");
  });
});

describe("buildPrecisionMap", () => {
  it("counts only HIT/MISS, keyed by confidence|bin", () => {
    const m = buildPrecisionMap([
      snap({ confidence: "HIGH", daysOutAtSnapshot: 10, outcome: "HIT" }),
      snap({ confidence: "HIGH", daysOutAtSnapshot: 20, outcome: "HIT" }),
      snap({ confidence: "HIGH", daysOutAtSnapshot: 40, outcome: "MISS" }),
      snap({ confidence: "MEDIUM", daysOutAtSnapshot: 100, outcome: "HIT" }),
    ]);
    expect(m.get("HIGH|0–45")).toEqual({ hit: 2, miss: 1 });
    expect(m.get("MEDIUM|46–120")).toEqual({ hit: 1, miss: 0 });
  });

  it("excludes PENDING / PRECONFIRMED / UNOBSERVED", () => {
    const m = buildPrecisionMap([
      snap({ outcome: "PENDING" }),
      snap({ outcome: "PRECONFIRMED" }),
      snap({ outcome: "UNOBSERVED" }),
    ]);
    expect(m.size).toBe(0);
  });
});

describe("tallyOutcomes", () => {
  it("counts each outcome plus a total", () => {
    const t = tallyOutcomes([
      { outcome: "PENDING" },
      { outcome: "PENDING" },
      { outcome: "HIT" },
      { outcome: "MISS" },
      { outcome: "PRECONFIRMED" },
      { outcome: "UNOBSERVED" },
    ]);
    expect(t).toEqual({ PENDING: 2, HIT: 1, MISS: 1, PRECONFIRMED: 1, UNOBSERVED: 1, total: 6 });
  });

  it("is all-zero for an empty set", () => {
    expect(tallyOutcomes([])).toEqual({ PENDING: 0, HIT: 0, MISS: 0, PRECONFIRMED: 0, UNOBSERVED: 0, total: 0 });
  });
});

describe("firstMaturityDate", () => {
  const d = (iso: string) => new Date(iso + "T12:00:00Z");

  it("returns the earliest PENDING predictedDate, ignoring scored rows", () => {
    const r = firstMaturityDate([
      { outcome: "HIT", predictedDate: d("2026-06-01") }, // ignored (not PENDING)
      { outcome: "PENDING", predictedDate: d("2026-08-15") },
      { outcome: "PENDING", predictedDate: d("2026-07-20") }, // earliest pending
    ]);
    expect(r?.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("returns null when nothing is PENDING", () => {
    expect(firstMaturityDate([{ outcome: "HIT", predictedDate: d("2026-06-01") }])).toBeNull();
  });
});

describe("shapeLeadTimeGrid", () => {
  it("fills the full HIGH/MEDIUM × 30/90/180 grid, keeping DB rows and blanking the rest", () => {
    const grid = shapeLeadTimeGrid([
      { confidence: "HIGH", horizon: 90, hits: 160, excluded: 2, medianLeadDays: 51.4, medianPostedAheadDays: 38.6, predictedFirst: 152 },
    ]);
    expect(grid).toHaveLength(6);
    expect(grid.map((c) => `${c.confidence}${c.horizon}`)).toEqual(["HIGH30", "HIGH90", "HIGH180", "MEDIUM30", "MEDIUM90", "MEDIUM180"]);
    expect(grid[1]).toMatchObject({ hits: 160, medianLeadDays: 51.4, predictedFirst: 152, excluded: 2 });
    expect(grid[0]).toMatchObject({ hits: 0, medianLeadDays: null, medianPostedAheadDays: null, predictedFirst: 0 });
  });
});

describe("unobservedReason", () => {
  const row = (over: Partial<UnobservedKennelRow>): UnobservedKennelRow => ({
    kennelCode: "k", shortName: "K", region: "R", unobserved: 10, noSourceAtSnapshot: 0, hit: 0, miss: 0, independentSourcesNow: 1, ...over,
  });

  it("no-source when every unobserved snapshot lacked an independent source and none exists now", () => {
    expect(unobservedReason(row({ noSourceAtSnapshot: 10, independentSourcesNow: 0 }))).toBe("no-source");
  });

  it("source-added when a source was linked after the snapshots were taken", () => {
    expect(unobservedReason(row({ noSourceAtSnapshot: 10, independentSourcesNow: 1 }))).toBe("source-added");
  });

  it("source-silent when a frozen source existed but posted nothing near the date", () => {
    expect(unobservedReason(row({ noSourceAtSnapshot: 3 }))).toBe("source-silent");
    expect(unobservedReason(row({ noSourceAtSnapshot: 0 }))).toBe("source-silent");
  });
});
