import {
  daysBetween,
  shouldCaptureBand,
  captureBandFor,
  classifyOutcome,
  type ScorableEvent,
} from "./prediction-ledger";

const d = (iso: string) => new Date(iso + "T12:00:00Z");
const ev = (id: string, iso: string, sourceIds: string[]): ScorableEvent => ({ id, date: d(iso), sourceIds });
const FROZEN = new Set(["src-a", "src-b"]);

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

describe("captureBandFor (exactly one band per run)", () => {
  it("assigns a descending date to its single nearby band", () => {
    expect(captureBandFor(180, null)).toBe(180);
    expect(captureBandFor(90, null)).toBe(90);
    expect(captureBandFor(30, null)).toBe(30);
    expect(captureBandFor(100, null)).toBeNull(); // between bands, no window
  });
  it("after a LONG outage picks ONLY the smallest crossed band — no triple-count (Codex)", () => {
    // prev=190, now=20 → shouldCaptureBand is true for 180, 90 AND 30; capture only 30.
    expect(shouldCaptureBand(20, 190, 180)).toBe(true);
    expect(shouldCaptureBand(20, 190, 90)).toBe(true);
    expect(shouldCaptureBand(20, 190, 30)).toBe(true);
    expect(captureBandFor(20, 190)).toBe(30);
  });
  it("recovery that only skipped the 180 window captures 180 alone", () => {
    expect(captureBandFor(100, 190)).toBe(180); // crossed 180 only (100 still > 90)
  });
});

describe("classifyOutcome", () => {
  const target = d("2026-03-14");

  it("PRECONFIRMED short-circuits on the contamination flag (Codex)", () => {
    const r = classifyOutcome(target, true, [ev("e1", "2026-03-14", ["src-a"])], FROZEN);
    expect(r.outcome).toBe("PRECONFIRMED");
    expect(r.matchedEventId).toBeNull();
  });

  it("HIT when a frozen-source event lands within ±1d, recording the event id", () => {
    const r = classifyOutcome(target, false, [ev("e9", "2026-03-15", ["src-b"])], FROZEN);
    expect(r.outcome).toBe("HIT");
    expect(r.matchedEventId).toBe("e9");
  });

  it("MISS when observed nearby (±14d) but no event within ±1d", () => {
    const r = classifyOutcome(target, false, [ev("e2", "2026-03-07", ["src-a"])], FROZEN);
    expect(r.outcome).toBe("MISS");
    expect(r.matchedEventId).toBeNull();
  });

  it("UNOBSERVED when no frozen-source event within ±14d", () => {
    const r = classifyOutcome(target, false, [ev("e3", "2026-02-01", ["src-a"])], FROZEN);
    expect(r.outcome).toBe("UNOBSERVED");
  });

  it("UNOBSERVED when the kennel has no events at all", () => {
    expect(classifyOutcome(target, false, [], FROZEN).outcome).toBe("UNOBSERVED");
  });

  it("IGNORES events from a source not in the frozen set — a later-added source can't retro-HIT (Codex)", () => {
    // event lands exactly on the date but comes from a source NOT frozen at snapshot time
    const r = classifyOutcome(target, false, [ev("late", "2026-03-14", ["src-new"])], FROZEN);
    expect(r.outcome).toBe("UNOBSERVED");
    expect(r.matchedEventId).toBeNull();
  });

  it("matches when an event carries both a frozen and a non-frozen source", () => {
    const r = classifyOutcome(target, false, [ev("mix", "2026-03-14", ["src-new", "src-a"])], FROZEN);
    expect(r.outcome).toBe("HIT");
    expect(r.matchedEventId).toBe("mix");
  });
});
