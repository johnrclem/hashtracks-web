import {
  buildNextEventMap,
  serializeKennelWithNext,
  nextRunLabel,
  kennelCardView,
} from "@/lib/kennel-directory";

const evidence = {
  lastRunSeenAt: new Date("2026-10-01T12:00:00Z"),
  nextRunPostedAt: null,
  lastConfirmedAt: null,
  lastConfirmedVia: null,
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
      lastConfirmedVia: null,
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

describe("serializeKennelWithNext listing-only passthrough", () => {
  it("passes listingOnly and scheduleNotes through", () => {
    const out = serializeKennelWithNext(
      { id: "k1", region: "Atlanta, GA", listingOnly: true, scheduleNotes: "Saturdays 2pm", ...evidence },
      new Map(),
    );
    expect(out.listingOnly).toBe(true);
    expect(out.scheduleNotes).toBe("Saturdays 2pm");
  });
});

describe("kennelCardView", () => {
  const base = { listingOnly: false, scheduleNotes: null, schedule: null, hasNextEvent: false };

  it("dims and shows the footer for an ordinary kennel with no next run", () => {
    expect(kennelCardView(base)).toEqual({ scheduleText: null, noUpcoming: true });
  });

  it("does not dim a kennel with a next run", () => {
    expect(kennelCardView({ ...base, hasNextEvent: true }).noUpcoming).toBe(false);
  });

  it("shows Usually: notes for a listing-only kennel with no structured schedule", () => {
    expect(kennelCardView({ ...base, listingOnly: true, scheduleNotes: "Saturdays 2pm" })).toEqual({
      scheduleText: "Usually: Saturdays 2pm",
      noUpcoming: false,
    });
  });

  it("prefers the structured schedule when there is one", () => {
    expect(
      kennelCardView({ ...base, listingOnly: true, scheduleNotes: "x", schedule: "Saturdays" }).scheduleText,
    ).toBe("Saturdays");
  });

  it("never shows notes for a non-listing kennel", () => {
    expect(kennelCardView({ ...base, scheduleNotes: "Seasonal" }).scheduleText).toBeNull();
  });
});
