import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { event: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { getHomeComingUp, getYourWeek } from "./home-coming-up";

const mockFindMany = vi.mocked(prisma.event.findMany);

// Wednesday, Nov 11 2026, 15:00 UTC.
const NOW = new Date(Date.UTC(2026, 10, 11, 15));

/** A run row as the Coming Up query selects it. */
function row(id: string, day: number, startTime: string | null) {
  const date = new Date(Date.UTC(2026, 10, day, 12));
  return {
    id,
    date,
    dateUtc: date,
    timezone: "America/New_York",
    latitude: 40.7,
    longitude: -74,
    runNumber: null,
    title: `Run ${id}`,
    haresText: null,
    startTime,
    locationName: null,
    locationCity: null,
    isScheduleOnly: false,
    kennel: {
      shortName: "NYCH3",
      fullName: "New York City H3",
      region: "New York City, NY",
      latitude: 40.7,
      longitude: -74,
      regionRef: { timezone: "America/New_York", centroidLat: 40.7, centroidLng: -74 },
    },
  };
}

describe("Coming Up select", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("carries isScheduleOnly so the homepage card can tag generated runs", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await getYourWeek("user_1", NOW);
    expect(mockFindMany.mock.calls[0][0]?.select).toMatchObject({ isScheduleOnly: true });
  });
});

describe("getYourWeek", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("scopes the query to the hasher's followed kennels, as host or co-host, over the next week", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await getYourWeek("user_1", NOW);

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where.AND).toEqual([
      { eventKennels: { some: { kennel: { members: { some: { user: { clerkId: "user_1" } } } } } } },
    ]);
    expect(where.date).toEqual({
      gte: new Date(Date.UTC(2026, 10, 10, 12)),
      lte: new Date(Date.UTC(2026, 10, 18, 12)),
    });
  });

  it("returns null when none of the followed kennels has a run ahead", async () => {
    // Nov 10 has already passed in New York.
    mockFindMany.mockResolvedValue([row("past", 10, null)] as never);
    expect(await getYourWeek("user_1", NOW)).toBeNull();
  });

  it("lists runs still ahead, soonest first, under the Your week heading", async () => {
    mockFindMany.mockResolvedValue([row("later", 14, "14:00"), row("sooner", 12, "19:00")] as never);
    const result = await getYourWeek("user_1", NOW);

    expect(result?.heading).toBe("Your week");
    expect(result?.events.map((e) => e.id)).toEqual(["sooner", "later"]);
  });
});

describe("getHomeComingUp", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("shows Your week when the signed-in hasher's kennels have runs ahead", async () => {
    mockFindMany.mockResolvedValueOnce([row("mine", 12, "19:00")] as never);
    const result = await getHomeComingUp("user_1", null, NOW);
    expect(result.heading).toBe("Your week");
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next runs anywhere when their kennels have nothing on", async () => {
    mockFindMany.mockResolvedValueOnce([] as never).mockResolvedValueOnce([row("any", 12, "19:00")] as never);
    const result = await getHomeComingUp("user_1", null, NOW);
    expect(result.heading).toBe("Coming up around the world");
    expect(result.events.map((e) => e.id)).toEqual(["any"]);
  });

  it("skips the Your week query for signed-out visitors", async () => {
    mockFindMany.mockResolvedValueOnce([] as never);
    await getHomeComingUp(null, null, NOW);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });
});
