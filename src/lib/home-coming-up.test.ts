import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { event: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { getYourWeek } from "./home-coming-up";

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

describe("getYourWeek", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns null without querying when the hasher follows no kennels", async () => {
    expect(await getYourWeek([], NOW)).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("scopes the query to followed kennels, as host or co-host, over the next week", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await getYourWeek(["k1", "k2"], NOW);

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where.AND).toEqual([{ eventKennels: { some: { kennelId: { in: ["k1", "k2"] } } } }]);
    expect(where.date).toEqual({
      gte: new Date(Date.UTC(2026, 10, 10, 12)),
      lte: new Date(Date.UTC(2026, 10, 18, 12)),
    });
  });

  it("returns null when none of the followed kennels has a run ahead", async () => {
    // Nov 10 has already passed in New York.
    mockFindMany.mockResolvedValue([row("past", 10, null)] as never);
    expect(await getYourWeek(["k1"], NOW)).toBeNull();
  });

  it("lists runs still ahead, soonest first, under the Your week heading", async () => {
    mockFindMany.mockResolvedValue([row("later", 14, "14:00"), row("sooner", 12, "19:00")] as never);
    const result = await getYourWeek(["k1"], NOW);

    expect(result?.heading).toBe("Your week");
    expect(result?.events.map((e) => e.id)).toEqual(["sooner", "later"]);
  });
});
