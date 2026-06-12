import {
  weekStartUtc,
  daysBetween,
  shouldCaptureBand,
  classifyOutcome,
} from "./prediction-ledger";

const d = (iso: string) => new Date(iso + "T12:00:00Z");

describe("weekStartUtc", () => {
  it("returns Monday 00:00 UTC of the week", () => {
    // 2026-06-12 is a Friday → Monday is 2026-06-08
    expect(weekStartUtc(d("2026-06-12")).toISOString()).toBe("2026-06-08T00:00:00.000Z");
    // A Monday maps to itself
    expect(weekStartUtc(d("2026-06-08")).toISOString()).toBe("2026-06-08T00:00:00.000Z");
    // A Sunday maps back to the prior Monday
    expect(weekStartUtc(d("2026-06-14")).toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });
});

describe("daysBetween", () => {
  it("counts whole days from→to", () => {
    expect(daysBetween(d("2026-06-01"), d("2026-06-08"))).toBe(7);
    expect(daysBetween(d("2026-06-08"), d("2026-06-01"))).toBe(-7);
  });
});

describe("shouldCaptureBand", () => {
  it("captures inside the ±4d window (normal weekly path)", () => {
    expect(shouldCaptureBand(180, null, 180)).toBe(true);
    expect(shouldCaptureBand(176, null, 180)).toBe(true);
    expect(shouldCaptureBand(184, null, 180)).toBe(true);
  });
  it("does not capture outside the window when there is no missed-run gap", () => {
    expect(shouldCaptureBand(175, null, 180)).toBe(false); // first run, below window
    expect(shouldCaptureBand(175, 183, 180)).toBe(false); // 183 was in window last run; capture happened then
  });
  it("recovers a cohort that jumped over the window during a missed run (Codex)", () => {
    // last successful run saw it at 190d; this run sees 170d → skipped [176,184]
    expect(shouldCaptureBand(170, 190, 180)).toBe(true);
  });
  it("works the same for the 90 and 30 bands", () => {
    expect(shouldCaptureBand(90, null, 90)).toBe(true);
    expect(shouldCaptureBand(28, null, 30)).toBe(true);
    expect(shouldCaptureBand(20, 40, 30)).toBe(true); // missed-run recovery
  });
});

describe("classifyOutcome", () => {
  const target = d("2026-03-14");
  it("PRECONFIRMED short-circuits on the contamination flag (Codex)", () => {
    const r = classifyOutcome(target, true, [{ id: "e1", date: target }]);
    expect(r.outcome).toBe("PRECONFIRMED");
    expect(r.matchedEventId).toBeNull();
  });
  it("HIT when an eligible event lands within ±1d, recording the event id", () => {
    const r = classifyOutcome(target, false, [{ id: "e9", date: d("2026-03-15") }]);
    expect(r.outcome).toBe("HIT");
    expect(r.matchedEventId).toBe("e9");
  });
  it("MISS when observed nearby (±14d) but no event within ±1d", () => {
    const r = classifyOutcome(target, false, [{ id: "e2", date: d("2026-03-07") }]);
    expect(r.outcome).toBe("MISS");
    expect(r.matchedEventId).toBeNull();
  });
  it("UNOBSERVED when no eligible event within ±14d (stale/inactive source — Codex)", () => {
    const r = classifyOutcome(target, false, [{ id: "e3", date: d("2026-02-01") }]);
    expect(r.outcome).toBe("UNOBSERVED");
  });
  it("UNOBSERVED when the kennel has no eligible events at all", () => {
    expect(classifyOutcome(target, false, []).outcome).toBe("UNOBSERVED");
  });
});
