import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findUnique: vi.fn() },
    sourceKennel: { findMany: vi.fn() },
    scheduleRule: { count: vi.fn() },
    rawEvent: { groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    event: { findFirst: vi.fn() },
    kennelConfirmation: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getHowWeKnow, getHowWeKnowOrEmpty } from "./kennel-how-we-know";

const NOW = new Date("2026-11-13T12:00:00Z");
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

const NO_EVIDENCE = {
  lastRunSeenAt: null,
  nextRunPostedAt: null,
  lastConfirmedAt: null,
  stoppedAt: null,
};

function link(name: string, type: string, enabled = true) {
  return { source: { id: `id-${name}`, name, type, enabled } };
}

/** A source that produced a real run in the coverage window (one grouped row per source). */
function realRunSource(name: string) {
  return { sourceId: `id-${name}` };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.scheduleRule.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.rawEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.rawEvent.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.event.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.kennelConfirmation.findMany).mockResolvedValue([] as never);
});

describe("getHowWeKnow coverage", () => {
  it("coverage is full when a non-schedule source produced a real run in the last 180 days", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("B Calendar", "GOOGLE_CALENDAR"),
      link("A Meetup", "MEETUP"),
    ] as never);
    vi.mocked(prisma.rawEvent.groupBy).mockResolvedValue([
      realRunSource("B Calendar"),
      realRunSource("A Meetup"),
    ] as never);
    const { coverage } = await getHowWeKnow("k1", NO_EVIDENCE, NOW);
    expect(coverage).toEqual({ level: "full", sourceNames: ["A Meetup", "B Calendar"] });
  });

  it("coverage asks only for distinct real-run sources since the 180-day floor", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Cal", "GOOGLE_CALENDAR"),
      link("Static", "STATIC_SCHEDULE"),
      link("Retired", "MEETUP", false),
    ] as never);
    await getHowWeKnow("k1", NO_EVIDENCE, NOW);

    const args = vi.mocked(prisma.rawEvent.groupBy).mock.calls[0][0] as {
      by: string[];
      where: { sourceId: unknown; event: { date: unknown; isScheduleOnly: unknown } };
    };
    // One row per source (GROUP BY), never every RawEvent of an aggregator kennel.
    expect(args.by).toEqual(["sourceId"]);
    // Enabled, non-STATIC_SCHEDULE sources only.
    expect(args.where.sourceId).toEqual({ in: ["id-Cal"] });
    // 180 days before today's UTC noon.
    expect(args.where.event.date).toEqual({ gte: d("2026-05-17") });
    expect(args.where.event.isScheduleOnly).toBe(false);
    expect(prisma.rawEvent.findMany).not.toHaveBeenCalled();
  });

  it("coverage is schedule when only a STATIC_SCHEDULE source or rule exists", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Static", "STATIC_SCHEDULE"),
    ] as never);
    expect((await getHowWeKnow("k1", NO_EVIDENCE, NOW)).coverage).toEqual({ level: "schedule" });

    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduleRule.count).mockResolvedValue(1 as never);
    expect((await getHowWeKnow("k1", NO_EVIDENCE, NOW)).coverage).toEqual({ level: "schedule" });
  });

  it("coverage is none with no sources or rules", async () => {
    expect((await getHowWeKnow("k1", NO_EVIDENCE, NOW)).coverage).toEqual({ level: "none" });
  });

  it("a linked feed with no real run in 180 days does not count as full", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Old Calendar", "GOOGLE_CALENDAR"),
    ] as never);
    // The date floor is in the query (asserted above), so nothing comes back.
    vi.mocked(prisma.rawEvent.groupBy).mockResolvedValue([] as never);
    expect((await getHowWeKnow("k1", NO_EVIDENCE, NOW)).coverage).toEqual({ level: "none" });
  });

  it("a feed that only returns schedule-only events reads as schedule, not none", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Philly Calendar", "GOOGLE_CALENDAR"),
    ] as never);
    vi.mocked(prisma.event.findFirst).mockResolvedValue({ id: "e-gen" } as never);
    expect((await getHowWeKnow("k1", NO_EVIDENCE, NOW)).coverage).toEqual({ level: "schedule" });
    const where = vi.mocked(prisma.event.findFirst).mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where).toMatchObject({
      isScheduleOnly: true,
      date: { gte: d("2026-05-17") },
      rawEvents: { some: { sourceId: { in: ["id-Philly Calendar"] } } },
    });
  });

  it("a disabled source never counts toward coverage", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Retired", "GOOGLE_CALENDAR", false),
    ] as never);
    expect((await getHowWeKnow("k1", NO_EVIDENCE, NOW)).coverage).toEqual({ level: "none" });
    expect(prisma.rawEvent.groupBy).not.toHaveBeenCalled();
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });
});

describe("getHowWeKnow items", () => {
  it("items are the newest three, newest first, from the evidence the page already loaded", async () => {
    const evidence = {
      lastRunSeenAt: d("2026-11-01"),
      nextRunPostedAt: d("2026-11-20"),
      lastConfirmedAt: d("2026-10-15"),
      stoppedAt: d("2026-08-01"),
    };
    vi.mocked(prisma.rawEvent.findFirst).mockResolvedValue({ source: { name: "Hash Calendar" } } as never);
    vi.mocked(prisma.kennelConfirmation.findMany).mockResolvedValue([
      { kind: "STOPPED", observedAt: d("2026-08-01"), note: "Gone", url: "https://x.test/s" },
      { kind: "RUNNING", observedAt: d("2026-10-15"), note: "Checked FB", url: "https://x.test/r" },
    ] as never);
    const { items } = await getHowWeKnow("k1", evidence, NOW);
    expect(items.map((i) => i.kind)).toEqual(["next-posted", "last-run", "confirmed"]);
    expect(items[1].detail).toBe("Hash Calendar");
    expect(items[2]).toMatchObject({ detail: "Checked FB", url: "https://x.test/r" });
    // The kennel's evidence is passed in, not re-read.
    expect(prisma.kennel.findUnique).not.toHaveBeenCalled();
    // One source lookup per dated run, for the last run and the next posted run.
    expect(prisma.rawEvent.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("getHowWeKnowOrEmpty", () => {
  it("logs a failure and renders an empty section instead of taking down the page", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.sourceKennel.findMany).mockRejectedValue(new Error("db down"));
    await expect(getHowWeKnowOrEmpty("k1", NO_EVIDENCE, NOW)).resolves.toEqual({
      coverage: { level: "none" },
      items: [],
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("passes a successful result through", async () => {
    vi.mocked(prisma.scheduleRule.count).mockResolvedValue(1 as never);
    await expect(getHowWeKnowOrEmpty("k1", NO_EVIDENCE, NOW)).resolves.toEqual({
      coverage: { level: "schedule" },
      items: [],
    });
  });
});
