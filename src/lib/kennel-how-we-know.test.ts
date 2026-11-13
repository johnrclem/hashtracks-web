import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findUnique: vi.fn() },
    sourceKennel: { findMany: vi.fn() },
    scheduleRule: { count: vi.fn() },
    rawEvent: { findMany: vi.fn(), findFirst: vi.fn() },
    kennelConfirmation: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getHowWeKnow } from "./kennel-how-we-know";

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

function feedRow(
  name: string,
  type: string,
  date: string,
  isScheduleOnly = false,
) {
  return {
    sourceId: `id-${name}`,
    source: { name, type },
    event: { date: d(date), isScheduleOnly },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.kennel.findUnique).mockResolvedValue(NO_EVIDENCE as never);
  vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.scheduleRule.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.rawEvent.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.rawEvent.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.kennelConfirmation.findMany).mockResolvedValue([] as never);
});

describe("getHowWeKnow coverage", () => {
  it("coverage is full when a non-schedule source produced a real run in the last 180 days", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("B Calendar", "GOOGLE_CALENDAR"),
      link("A Meetup", "MEETUP"),
    ] as never);
    vi.mocked(prisma.rawEvent.findMany).mockResolvedValue([
      feedRow("B Calendar", "GOOGLE_CALENDAR", "2026-10-01"),
      feedRow("B Calendar", "GOOGLE_CALENDAR", "2026-10-08"),
      feedRow("A Meetup", "MEETUP", "2026-11-20"),
    ] as never);
    const { coverage } = await getHowWeKnow("k1", NOW);
    expect(coverage).toEqual({ level: "full", sourceNames: ["A Meetup", "B Calendar"] });
  });

  it("coverage is schedule when only a STATIC_SCHEDULE source or rule exists", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Static", "STATIC_SCHEDULE"),
    ] as never);
    expect((await getHowWeKnow("k1", NOW)).coverage).toEqual({ level: "schedule" });

    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.scheduleRule.count).mockResolvedValue(1 as never);
    expect((await getHowWeKnow("k1", NOW)).coverage).toEqual({ level: "schedule" });
  });

  it("coverage is none with no sources or rules", async () => {
    expect((await getHowWeKnow("k1", NOW)).coverage).toEqual({ level: "none" });
  });

  it("a linked feed with no real run in 180 days does not count as full", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Old Calendar", "GOOGLE_CALENDAR"),
    ] as never);
    vi.mocked(prisma.rawEvent.findMany).mockResolvedValue([
      feedRow("Old Calendar", "GOOGLE_CALENDAR", "2026-02-01"),
    ] as never);
    expect((await getHowWeKnow("k1", NOW)).coverage).toEqual({ level: "none" });
  });

  it("a feed that only returns schedule-only events reads as schedule, not none", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Philly Calendar", "GOOGLE_CALENDAR"),
    ] as never);
    vi.mocked(prisma.rawEvent.findMany).mockResolvedValue([
      feedRow("Philly Calendar", "GOOGLE_CALENDAR", "2026-11-14", true),
    ] as never);
    expect((await getHowWeKnow("k1", NOW)).coverage).toEqual({ level: "schedule" });
  });

  it("a disabled source never counts toward coverage", async () => {
    vi.mocked(prisma.sourceKennel.findMany).mockResolvedValue([
      link("Retired", "GOOGLE_CALENDAR", false),
    ] as never);
    expect((await getHowWeKnow("k1", NOW)).coverage).toEqual({ level: "none" });
    expect(prisma.rawEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("getHowWeKnow items", () => {
  it("items are the newest three, newest first", async () => {
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({
      lastRunSeenAt: d("2026-11-01"),
      nextRunPostedAt: d("2026-11-20"),
      lastConfirmedAt: d("2026-10-15"),
      stoppedAt: d("2026-08-01"),
    } as never);
    vi.mocked(prisma.rawEvent.findFirst).mockResolvedValue({ source: { name: "Hash Calendar" } } as never);
    vi.mocked(prisma.kennelConfirmation.findMany).mockResolvedValue([
      { kind: "STOPPED", observedAt: d("2026-08-01"), note: "Gone", url: "https://x.test/s" },
      { kind: "RUNNING", observedAt: d("2026-10-15"), note: "Checked FB", url: "https://x.test/r" },
    ] as never);
    const { items } = await getHowWeKnow("k1", NOW);
    expect(items.map((i) => i.kind)).toEqual(["next-posted", "last-run", "confirmed"]);
    expect(items[1].detail).toBe("Hash Calendar");
    expect(items[2]).toMatchObject({ detail: "Checked FB", url: "https://x.test/r" });
  });
});
