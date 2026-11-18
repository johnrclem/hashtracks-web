import {
  buildNextEventMap,
  serializeKennelWithNext,
  nextRunLabel,
} from "@/lib/kennel-directory";

const evidence = {
  lastRunSeenAt: new Date("2026-10-01T12:00:00Z"),
  nextRunPostedAt: null,
  lastConfirmedAt: null,
  stoppedAt: null,
};

describe("buildNextEventMap", () => {
  it("keeps isScheduleOnly", () => {
    const map = buildNextEventMap([
      {
        date: new Date("2026-11-20T12:00:00Z"),
        title: "Usual run",
        isScheduleOnly: true,
        eventKennels: [{ kennelId: "k1" }],
      },
    ]);
    expect(map.get("k1")).toMatchObject({ isScheduleOnly: true });
  });
});

describe("serializeKennelWithNext", () => {
  it("carries evidence and the next event's isScheduleOnly", () => {
    const next = new Date("2026-11-20T12:00:00Z");
    const map = buildNextEventMap([
      { date: next, title: null, isScheduleOnly: true, eventKennels: [{ kennelId: "k1" }] },
    ]);
    const out = serializeKennelWithNext({ id: "k1", region: "New York City, NY", ...evidence }, map);
    expect(out.evidence).toEqual({
      lastRunSeenAt: "2026-10-01T12:00:00.000Z",
      nextRunPostedAt: null,
      lastConfirmedAt: null,
      stoppedAt: null,
    });
    expect(out.nextEvent).toEqual({ date: next.toISOString(), title: null, isScheduleOnly: true });
  });

  it("gives a null nextEvent when the kennel has none", () => {
    const out = serializeKennelWithNext({ id: "k2", region: "New York City, NY", ...evidence }, new Map());
    expect(out.nextEvent).toBeNull();
  });
});

describe("nextRunLabel", () => {
  it("directory card footer label is 'Usual schedule:' for a schedule-only next event", () => {
    expect(nextRunLabel({ isScheduleOnly: true })).toBe("Usual schedule: ");
    expect(nextRunLabel({ isScheduleOnly: false })).toBe("Next run: ");
  });
});
