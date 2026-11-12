import {
  getKennelState,
  getStatusLine,
  formatStatusLine,
  runningKennelWhere,
  listedKennelWhere,
  serializeKennelEvidence,
  toKennelEvidence,
  type KennelEvidence,
} from "@/lib/kennel-status";

const NOW = new Date("2026-11-10T15:00:00Z");

function offset(n: number): Date {
  return new Date(Date.UTC(2026, 10, 10 + n, 12, 0, 0));
}

function ev(partial: Partial<KennelEvidence> = {}): KennelEvidence {
  return { lastRunSeenAt: null, nextRunPostedAt: null, lastConfirmedAt: null, stoppedAt: null, ...partial };
}

describe("getKennelState", () => {
  it("returns not-seen with no evidence", () => {
    expect(getKennelState(ev(), NOW)).toBe("not-seen");
  });

  it.each([
    [0, "running"],
    [89, "running"],
    [90, "quiet"],
    [91, "quiet"],
    [364, "quiet"],
    [365, "not-seen"],
    [366, "not-seen"],
  ])("last run seen %i days ago is %s", (days, state) => {
    expect(getKennelState(ev({ lastRunSeenAt: offset(-days) }), NOW)).toBe(state);
  });

  it("a confirmation counts as evidence", () => {
    expect(getKennelState(ev({ lastConfirmedAt: offset(-10) }), NOW)).toBe("running");
  });

  it("a real run posted 60 days out is running; 61 days out is not", () => {
    expect(getKennelState(ev({ nextRunPostedAt: offset(60) }), NOW)).toBe("running");
    expect(getKennelState(ev({ nextRunPostedAt: offset(61) }), NOW)).toBe("not-seen");
  });

  it("a stale nextRunPostedAt in the past counts as evidence", () => {
    expect(getKennelState(ev({ nextRunPostedAt: offset(-100) }), NOW)).toBe("quiet");
    expect(getKennelState(ev({ nextRunPostedAt: offset(-5) }), NOW)).toBe("running");
  });

  it("stoppedAt makes the state stopped", () => {
    expect(getKennelState(ev({ stoppedAt: offset(-1), lastRunSeenAt: offset(-200) }), NOW)).toBe("stopped");
  });
});

describe("getStatusLine", () => {
  it("is null when running", () => {
    expect(getStatusLine(ev({ lastRunSeenAt: offset(-5) }), NOW)).toBeNull();
  });

  it("shows stopped first", () => {
    const stoppedAt = offset(-3);
    expect(getStatusLine(ev({ stoppedAt, nextRunPostedAt: offset(100) }), NOW)).toEqual({ kind: "stopped", date: stoppedAt });
  });

  it("a far-off posted run with no other evidence shows next-posted", () => {
    const nextRunPostedAt = offset(90);
    expect(getStatusLine(ev({ nextRunPostedAt }), NOW)).toEqual({ kind: "next-posted", date: nextRunPostedAt });
  });

  it("shows never with no evidence", () => {
    expect(getStatusLine(ev(), NOW)).toEqual({ kind: "never" });
  });

  it("a confirmation newer than the last run shows checked", () => {
    const lastConfirmedAt = offset(-120);
    expect(getStatusLine(ev({ lastRunSeenAt: offset(-200), lastConfirmedAt }), NOW)).toEqual({ kind: "checked", date: lastConfirmedAt });
  });

  it("shows last-run otherwise", () => {
    const lastRunSeenAt = offset(-150);
    expect(getStatusLine(ev({ lastRunSeenAt, lastConfirmedAt: offset(-300) }), NOW)).toEqual({ kind: "last-run", date: lastRunSeenAt });
  });
});

describe("formatStatusLine", () => {
  it("uses MMM d this year and MMM yyyy otherwise", () => {
    const thisYear = new Date("2026-03-05T12:00:00Z");
    const lastYear = new Date("2025-11-20T12:00:00Z");
    expect(formatStatusLine({ kind: "last-run", date: thisYear }, NOW)).toBe("Last run we saw · Mar 5");
    expect(formatStatusLine({ kind: "last-run", date: lastYear }, NOW)).toBe("Last run we saw · Nov 2025");
    expect(formatStatusLine({ kind: "checked", date: thisYear }, NOW)).toBe("Checked running · Mar 5");
    expect(formatStatusLine({ kind: "next-posted", date: new Date("2027-02-14T12:00:00Z") }, NOW)).toBe("Next run posted · Feb 2027");
    expect(formatStatusLine({ kind: "stopped", date: lastYear }, NOW)).toBe("Stopped · Nov 2025");
    expect(formatStatusLine({ kind: "never" }, NOW)).toBe("No runs seen on HashTracks");
  });
});

describe("where clauses", () => {
  it("runningKennelWhere filters hidden and stopped kennels", () => {
    expect(runningKennelWhere(NOW)).toEqual({
      isHidden: false,
      stoppedAt: null,
      OR: [
        { lastRunSeenAt: { gte: new Date("2026-08-13T12:00:00Z") } },
        { lastConfirmedAt: { gte: new Date("2026-08-13T12:00:00Z") } },
        { nextRunPostedAt: { gte: new Date("2026-08-13T12:00:00Z"), lte: new Date("2027-01-09T12:00:00Z") } },
      ],
    });
  });

  it("listedKennelWhere widens the window to a year", () => {
    expect(listedKennelWhere(NOW)).toEqual({
      isHidden: false,
      stoppedAt: null,
      OR: [
        { lastRunSeenAt: { gte: new Date("2025-11-11T12:00:00Z") } },
        { lastConfirmedAt: { gte: new Date("2025-11-11T12:00:00Z") } },
        { nextRunPostedAt: { gte: new Date("2025-11-11T12:00:00Z"), lte: new Date("2027-01-09T12:00:00Z") } },
      ],
    });
  });
});

describe("serialization", () => {
  it("serialize/toKennelEvidence round-trip", () => {
    const e = ev({ lastRunSeenAt: offset(-3), stoppedAt: offset(2) });
    const s = serializeKennelEvidence(e);
    expect(s.lastRunSeenAt).toBe("2026-11-07T12:00:00.000Z");
    expect(s.nextRunPostedAt).toBeNull();
    expect(toKennelEvidence(s)).toEqual(e);
  });
});
