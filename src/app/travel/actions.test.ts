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
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const travelDestination = {
    deleteMany: vi.fn(),
  };
  const kennel = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  // saveTravelSearch + deleteTravelSearch wrap their writes in
  // prisma.$transaction. The callback form passes a `tx` argument that
  // proxies the same model methods, so we hand it the same mock objects.
  // The array form (used by deleteTravelSearch) just runs each promise.
  const $transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => Promise<unknown>)({
        travelSearch,
        travelDestination,
        kennel,
      });
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  return {
    prisma: { travelSearch, travelDestination, kennel, $transaction },
  };
});

import { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  saveTravelSearch,
  updateTravelSearch,
  deleteTravelSearch,
  findExistingSavedSearch,
  listSavedSearches,
  viewTravelSearch,
  getDestinationKennelCount,
  resolveDestinationTimezone,
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
      status: "ACTIVE",
      lastViewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await saveTravelSearch(validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-1");

    // Atomic dedup: must run inside a transaction.
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.travelSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          name: expect.stringContaining("Atlanta, GA"),
        }),
      }),
    );
    // Denormalized userId must be propagated to the nested destination so
    // the new dedup unique index has something to enforce on.
    const createCall = vi.mocked(prisma.travelSearch.create).mock.calls[0][0];
    expect(createCall?.data?.destinations).toMatchObject({
      create: expect.objectContaining({ userId: "user-1" }),
    });
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

  it("rejects impossible calendar dates like Feb 31", async () => {
    const result = await saveTravelSearch({
      ...validParams,
      startDate: "2026-02-31",
    });
    expect("error" in result && result.error).toContain("date");
  });

  it("rejects month 13", async () => {
    const result = await saveTravelSearch({
      ...validParams,
      startDate: "2026-13-01",
    });
    expect("error" in result && result.error).toContain("date");
  });

  it("is idempotent — returns existing id without creating when coord+dates match", async () => {
    // Inside the transaction the findFirst short-circuit returns the
    // existing row; no create runs.
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-existing",
    } as never);

    const result = await saveTravelSearch(validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-existing");
    expect(prisma.travelSearch.create).not.toHaveBeenCalled();
  });

  it("recovers from a P2002 race by returning the winner's id", async () => {
    // Codex #1: a concurrent caller could insert a duplicate active row
    // before our findFirst saw it. The new dedup unique index turns that
    // race into a P2002 — we catch it, refetch the winning row, and
    // return its id so the loser sees idempotent semantics.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on TravelDestination_user_dedup",
      { code: "P2002", clientVersion: "test" },
    );
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-winner",
    } as never);

    const result = await saveTravelSearch(validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-winner");
  });

  it("rejects radiusKm above the 250km clamp", async () => {
    const result = await saveTravelSearch({ ...validParams, radiusKm: 99999 });
    expect("error" in result && result.error).toContain("Radius too large");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("updateTravelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces destination in-place and keeps the same id", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);

    const result = await updateTravelSearch("ts-1", validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-1");

    // update() called on the parent with nested destinations deleteMany+create
    const call = vi.mocked(prisma.travelSearch.update).mock.calls[0][0];
    expect(call?.where).toEqual({ id: "ts-1" });
    expect(call?.data?.destinations).toMatchObject({
      deleteMany: {},
      create: expect.objectContaining({ label: validParams.label }),
    });
    // No new TravelSearch row created — dashboard position preserved.
    expect(prisma.travelSearch.create).not.toHaveBeenCalled();
  });

  it("returns error for wrong owner", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "other-user",
    } as never);

    const result = await updateTravelSearch("ts-1", validParams);
    expect("error" in result && result.error).toBe("Not authorized");
    expect(prisma.travelSearch.update).not.toHaveBeenCalled();
  });

  it("returns error for non-existent search", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue(null);
    const result = await updateTravelSearch("ts-nonexistent", validParams);
    expect("error" in result && result.error).toBe("Search not found");
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await updateTravelSearch("ts-1", validParams);
    expect("error" in result && result.error).toBe("Not authenticated");
    expect(prisma.travelSearch.findUnique).not.toHaveBeenCalled();
  });

  it("validates params before touching the db", async () => {
    const result = await updateTravelSearch("ts-1", {
      ...validParams,
      startDate: "not-a-date",
    });
    expect("error" in result && result.error).toContain("date");
    expect(prisma.travelSearch.findUnique).not.toHaveBeenCalled();
  });
});

describe("deleteTravelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("archives the search and deletes its destination row", async () => {
    // Archive must do BOTH things in the same transaction so re-saving the
    // same trip after archive succeeds (the unique slot is freed).
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);
    vi.mocked(prisma.travelDestination.deleteMany).mockResolvedValue({
      count: 1,
    } as never);

    const result = await deleteTravelSearch("ts-1");
    expect("error" in result).toBe(false);
    expect(prisma.travelDestination.deleteMany).toHaveBeenCalledWith({
      where: { travelSearchId: "ts-1" },
    });
    expect(prisma.travelSearch.update).toHaveBeenCalledWith({
      where: { id: "ts-1" },
      data: { status: "ARCHIVED" },
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

describe("listSavedSearches cap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("caps the dashboard at 50 trips to limit weather API fan-out", async () => {
    vi.mocked(prisma.travelSearch.findMany).mockResolvedValue([] as never);
    await listSavedSearches();
    const call = vi.mocked(prisma.travelSearch.findMany).mock.calls[0][0];
    expect(call?.take).toBe(50);
  });
});

describe("listSavedSearches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user's active searches with destinations", async () => {
    vi.mocked(prisma.travelSearch.findMany).mockResolvedValue([
      {
        id: "ts-1",
        name: "Atlanta · Apr 14–21",
        status: "ACTIVE",
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

describe("findExistingSavedSearch", () => {
  const BASE = {
    latitude: 42.35,
    longitude: -71.06,
    radiusKm: 50,
    startDate: "2026-04-14",
    endDate: "2026-04-20",
  };

  beforeEach(() => vi.clearAllMocks());

  it("returns the matching search id when found", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-42",
    } as never);
    const result = await findExistingSavedSearch(BASE);
    expect(result).toBe("ts-42");
  });

  it("returns null when no match exists", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce(null);
    const result = await findExistingSavedSearch(BASE);
    expect(result).toBeNull();
  });

  it("scopes the lookup to the current user and active status", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce(null);
    await findExistingSavedSearch(BASE);
    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    expect(call?.where).toMatchObject({
      userId: "user-1",
      status: "ACTIVE",
    });
  });

  it("matches on coords + radius + dates via destinations.some", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce(null);
    await findExistingSavedSearch(BASE);
    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    expect(call?.where?.destinations?.some).toMatchObject({
      latitude: BASE.latitude,
      longitude: BASE.longitude,
      radiusKm: BASE.radiusKm,
    });
  });

  it("returns null for unauthenticated users", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await findExistingSavedSearch(BASE);
    expect(result).toBeNull();
    expect(prisma.travelSearch.findFirst).not.toHaveBeenCalled();
  });

  it("swallows errors and returns null so the page renders as unsaved", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockRejectedValueOnce(
      new Error("db down"),
    );
    const result = await findExistingSavedSearch(BASE);
    expect(result).toBeNull();
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

  it("clamps radius to 250km max", async () => {
    vi.mocked(prisma.kennel.findMany).mockResolvedValue([
      { latitude: 40.0, longitude: -74.0, regionRef: null },
    ] as never);

    // 10000km radius should be clamped to 250km — NYC kennel is ~1200km from Atlanta
    const result = await getDestinationKennelCount(33.749, -84.388, 10000);
    expect(result.count).toBe(0); // NYC is beyond 250km from Atlanta
  });
});

describe("resolveDestinationTimezone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error for invalid coordinates", async () => {
    const result = await resolveDestinationTimezone(NaN, NaN);
    expect("error" in result && result.error).toBe("Invalid coordinates");
  });

  it("returns error when API key is not configured", async () => {
    const originalKey = process.env.GOOGLE_CALENDAR_API_KEY;
    delete process.env.GOOGLE_CALENDAR_API_KEY;
    try {
      const result = await resolveDestinationTimezone(33.749, -84.388);
      expect("error" in result && result.error).toBe("Time Zone API not configured");
    } finally {
      if (originalKey) process.env.GOOGLE_CALENDAR_API_KEY = originalKey;
    }
  });
});
