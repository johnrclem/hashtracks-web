import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth — value inlined because vi.mock is hoisted above const declarations
vi.mock("@/lib/auth", () => ({
  getOrCreateUser: vi.fn().mockResolvedValue({
    id: "user-1",
    clerkId: "clerk-1",
    email: "test@test.com",
  }),
}));

// Mock Prisma
vi.mock("@/lib/db", () => {
  const travelSearch = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const kennel = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  return {
    prisma: { travelSearch, kennel },
  };
});

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  saveTravelSearch,
  deleteTravelSearch,
  listSavedSearches,
  viewTravelSearch,
  getDestinationKennelCount,
} from "./actions";

const validParams = {
  label: "Atlanta, GA",
  latitude: 33.749,
  longitude: -84.388,
  radiusKm: 50,
  startDate: "2026-04-14",
  endDate: "2026-04-21",
};

describe("saveTravelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a search with auto-generated name", async () => {
    vi.mocked(prisma.travelSearch.create).mockResolvedValue({
      id: "ts-1",
      userId: "user-1",
      name: "Atlanta, GA · Apr 14–21",
      status: "active",
      lastViewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await saveTravelSearch(validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-1");

    expect(prisma.travelSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          name: expect.stringContaining("Atlanta, GA"),
        }),
      }),
    );
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await saveTravelSearch(validParams);
    expect("error" in result && result.error).toBe("Not authenticated");
  });

  it("returns error for empty label", async () => {
    const result = await saveTravelSearch({ ...validParams, label: "  " });
    expect("error" in result && result.error).toContain("label");
  });

  it("returns error for invalid latitude", async () => {
    const result = await saveTravelSearch({ ...validParams, latitude: 91 });
    expect("error" in result && result.error).toContain("latitude");
  });

  it("returns error for invalid longitude", async () => {
    const result = await saveTravelSearch({ ...validParams, longitude: 181 });
    expect("error" in result && result.error).toContain("longitude");
  });

  it("returns error for inverted dates", async () => {
    const result = await saveTravelSearch({
      ...validParams,
      startDate: "2026-04-21",
      endDate: "2026-04-14",
    });
    expect("error" in result && result.error).toContain("End date");
  });

  it("returns error for invalid date strings", async () => {
    const result = await saveTravelSearch({
      ...validParams,
      startDate: "not-a-date",
    });
    expect("error" in result && result.error).toContain("date");
  });
});

describe("deleteTravelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("archives the search on delete", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);

    const result = await deleteTravelSearch("ts-1");
    expect("error" in result).toBe(false);
    expect(prisma.travelSearch.update).toHaveBeenCalledWith({
      where: { id: "ts-1" },
      data: { status: "archived" },
    });
  });

  it("returns error for wrong owner", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "other-user",
    } as never);

    const result = await deleteTravelSearch("ts-1");
    expect("error" in result && result.error).toBe("Not authorized");
  });

  it("returns error for non-existent search", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue(null);
    const result = await deleteTravelSearch("ts-nonexistent");
    expect("error" in result && result.error).toBe("Search not found");
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await deleteTravelSearch("ts-1");
    expect("error" in result && result.error).toBe("Not authenticated");
  });
});

describe("listSavedSearches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user's active searches with destinations", async () => {
    vi.mocked(prisma.travelSearch.findMany).mockResolvedValue([
      {
        id: "ts-1",
        name: "Atlanta · Apr 14–21",
        status: "active",
        lastViewedAt: new Date(),
        createdAt: new Date(),
        destinations: [
          {
            label: "Atlanta, GA",
            latitude: 33.749,
            longitude: -84.388,
            timezone: "America/New_York",
            radiusKm: 50,
            startDate: new Date("2026-04-14T12:00:00Z"),
            endDate: new Date("2026-04-21T12:00:00Z"),
          },
        ],
      },
    ] as never);

    const result = await listSavedSearches();
    expect("error" in result).toBe(false);
    expect("searches" in result && result.searches).toHaveLength(1);
    expect("searches" in result && result.searches[0].destination?.label).toBe("Atlanta, GA");
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await listSavedSearches();
    expect("error" in result && result.error).toBe("Not authenticated");
  });
});

describe("viewTravelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates lastViewedAt and returns search", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      id: "ts-1",
      userId: "user-1",
      name: "Atlanta · Apr 14–21",
      destinations: [
        {
          label: "Atlanta, GA",
          placeId: "ChIJjQmT...",
          latitude: 33.749,
          longitude: -84.388,
          timezone: "America/New_York",
          radiusKm: 50,
          startDate: new Date("2026-04-14T12:00:00Z"),
          endDate: new Date("2026-04-21T12:00:00Z"),
        },
      ],
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);

    const result = await viewTravelSearch("ts-1");
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-1");

    // Verify lastViewedAt was updated
    expect(prisma.travelSearch.update).toHaveBeenCalledWith({
      where: { id: "ts-1" },
      data: { lastViewedAt: expect.any(Date) },
    });
  });

  it("returns error for wrong owner", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "other-user",
      destinations: [],
    } as never);

    const result = await viewTravelSearch("ts-1");
    expect("error" in result && result.error).toBe("Not authorized");
  });
});

describe("getDestinationKennelCount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts kennels within radius", async () => {
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { latitude: 33.75, longitude: -84.39, regionRef: null },  // ~1km from Atlanta
      { latitude: 34.05, longitude: -84.39, regionRef: null },  // ~33km from Atlanta
      { latitude: 40.0, longitude: -74.0, regionRef: null },    // ~1200km (NYC area)
    ] as never);

    const result = await getDestinationKennelCount(33.749, -84.388, 50);
    expect(result.count).toBe(2); // Only the two within 50km
  });

  it("uses region centroid as fallback for kennels without coordinates", async () => {
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      {
        latitude: null,
        longitude: null,
        regionRef: { centroidLat: 51.5, centroidLng: -0.1 },
      },
    ] as never);

    // Use London coords (distinct cache key from the Atlanta test above)
    const result = await getDestinationKennelCount(51.507, -0.128, 50);
    expect(result.count).toBe(1);
  });

  it("returns 0 for invalid coordinates", async () => {
    const result = await getDestinationKennelCount(NaN, NaN, 50);
    expect(result.count).toBe(0);
  });
});
