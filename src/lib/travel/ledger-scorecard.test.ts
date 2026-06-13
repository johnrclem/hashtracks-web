import {
  binOf,
  buildPrecisionMap,
  tallyOutcomes,
  firstMaturityDate,
  type ScorecardSnap,
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
