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
    updateMany: vi.fn(),
  };
  const travelDestination = {
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
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
  restoreTravelSearch,
  saveDraftSearch,
  updateDraftSearch,
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
      itinerarySignature: "deadbeef",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 1 } as never);

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
          itinerarySignature: expect.any(String),
        }),
      }),
    );
    // Compound FK requires denormalized userId + explicit position on the
    // child insert. createMany takes the full array even for single-dest.
    const createManyCall = vi.mocked(prisma.travelDestination.createMany).mock.calls[0][0];
    const rows = createManyCall?.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      travelSearchId: "ts-1",
      userId: "user-1",
      position: 0,
      status: "ACTIVE",
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

  it.each([
    ["invalid date strings", "not-a-date"],
    ["impossible calendar dates like Feb 31", "2026-02-31"],
    ["month 13", "2026-13-01"],
  ])("rejects %s", async (_label, startDate) => {
    const result = await saveTravelSearch({ ...validParams, startDate });
    expect("error" in result && result.error).toContain("date");
  });

  it("is idempotent — short-circuits via in-transaction findFirst when a trip already exists", async () => {
    // The cheap path: the in-transaction findFirst returns the existing
    // row without writing. TravelAutoSave + double-clicks + page refreshes
    // all go through this path. Codex flagged earlier that an
    // exception-driven write path here was needless write amplification.
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-existing",
    } as never);

    const result = await saveTravelSearch(validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-existing");
    expect(prisma.travelSearch.create).not.toHaveBeenCalled();
  });

  it("recovers from a concurrent-insert P2002 race by returning the winner's id", async () => {
    // The fallback path: a concurrent caller (cross-tab, parallel
    // request) inserts between our findFirst and our create. The DB
    // partial-unique throws P2002; we refetch the winner so the loser
    // sees the same idempotent semantics as if it had won.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on TravelDestination_user_dedup_active",
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

  // With multi-stop support the dedup key is a SHA-256 of the canonical
  // itinerary JSON. When a stop carries placeId, the canonical form omits
  // lat/lng so the same place across provider paths (autocomplete vs
  // server-side geocode, coords differ by ~0.0001°) still produces the
  // same signature. Without placeId the signature falls back to coords.
  it.each([
    ["placeId", "ts-placeid", { ...validParams, placeId: "ChIJplace123" }],
    ["coords",  "ts-coords",  validParams],
  ])("dedups by itinerarySignature keyed on %s", async (_label, id, params) => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({ id } as never);

    const result = await saveTravelSearch(params);
    expect("id" in result && result.id).toBe(id);

    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    const where = (call as { where?: Record<string, unknown> })?.where ?? {};
    expect(where).toMatchObject({
      userId: "user-1",
      status: "ACTIVE",
      itinerarySignature: expect.any(String),
    });
  });

  it("saves a 3-stop itinerary with positions 0..2 (#multi-dest)", async () => {
    vi.mocked(prisma.travelSearch.create).mockResolvedValue({
      id: "ts-multi",
      userId: "user-1",
      name: "London → Paris → Berlin · Apr 14–26",
      status: "ACTIVE",
      lastViewedAt: null,
      itinerarySignature: "abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 3 } as never);

    const result = await saveTravelSearch({
      destinations: [
        { label: "London", latitude: 51.5, longitude: -0.12, radiusKm: 50, startDate: "2026-04-14", endDate: "2026-04-18" },
        { label: "Paris",  latitude: 48.8, longitude:  2.35, radiusKm: 50, startDate: "2026-04-18", endDate: "2026-04-22" },
        { label: "Berlin", latitude: 52.5, longitude: 13.4,  radiusKm: 50, startDate: "2026-04-22", endDate: "2026-04-26" },
      ],
    });
    expect("id" in result && result.id).toBe("ts-multi");

    const createManyCall = vi.mocked(prisma.travelDestination.createMany).mock.calls[0][0];
    const rows = createManyCall?.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.label)).toEqual(["London", "Paris", "Berlin"]);
  });

  it("rejects > 3 stops", async () => {
    const stops = Array.from({ length: 4 }, (_, i) => ({
      label: `Stop ${i}`,
      latitude: 33.749,
      longitude: -84.388,
      radiusKm: 50,
      startDate: `2026-04-${String(14 + i).padStart(2, "0")}`,
      endDate: `2026-04-${String(15 + i).padStart(2, "0")}`,
    }));
    const result = await saveTravelSearch({ destinations: stops });
    expect("error" in result && result.error).toContain("At most 3");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects destinations whose startDates regress (non-sequential legs)", async () => {
    const result = await saveTravelSearch({
      destinations: [
        { label: "A", latitude: 1, longitude: 1, radiusKm: 50, startDate: "2026-04-20", endDate: "2026-04-23" },
        { label: "B", latitude: 2, longitude: 2, radiusKm: 50, startDate: "2026-04-19", endDate: "2026-04-22" },
      ],
    });
    expect("error" in result && result.error).toContain("Leg 2 must start on or after leg 1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows legs to share a boundary date (overlap day)", async () => {
    vi.mocked(prisma.travelSearch.create).mockResolvedValue({
      id: "ts-overlap",
      userId: "user-1",
      name: "London → Paris · Apr 20–26",
      status: "ACTIVE",
      lastViewedAt: null,
      itinerarySignature: "xyz",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 2 } as never);

    const result = await saveTravelSearch({
      destinations: [
        { label: "London", latitude: 51.5, longitude: -0.12, radiusKm: 50, startDate: "2026-04-20", endDate: "2026-04-23" },
        { label: "Paris",  latitude: 48.8, longitude:  2.35, radiusKm: 50, startDate: "2026-04-23", endDate: "2026-04-26" },
      ],
    });
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-overlap");
  });

  it("same itinerary in different orders produces different signatures", async () => {
    // London → Paris should NOT dedup with Paris → London.
    const { computeItinerarySignature } = await import("@/lib/travel/limits");
    const lonToPar = computeItinerarySignature([
      { latitude: 51.5, longitude: -0.12, radiusKm: 50, startDate: "2026-04-20", endDate: "2026-04-23" },
      { latitude: 48.8, longitude:  2.35, radiusKm: 50, startDate: "2026-04-23", endDate: "2026-04-26" },
    ]);
    const parToLon = computeItinerarySignature([
      { latitude: 48.8, longitude:  2.35, radiusKm: 50, startDate: "2026-04-20", endDate: "2026-04-23" },
      { latitude: 51.5, longitude: -0.12, radiusKm: 50, startDate: "2026-04-23", endDate: "2026-04-26" },
    ]);
    expect(lonToPar).not.toEqual(parToLon);
  });

  it("rejects radiusKm above the 250km clamp", async () => {
    const result = await saveTravelSearch({ ...validParams, radiusKm: 99999 });
    expect("error" in result && result.error).toContain("Radius too large");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects fractional radiusKm before reaching Prisma's Int column", async () => {
    // Codex: TravelDestination.radiusKm is an Int, so 12.5 throws at
    // write time as a 500. Catch it at validation as a user-facing error.
    const result = await saveTravelSearch({ ...validParams, radiusKm: 12.5 });
    expect("error" in result && result.error).toContain("whole number");
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
    vi.mocked(prisma.travelDestination.deleteMany).mockResolvedValue({
      count: 1,
    } as never);
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await updateTravelSearch("ts-1", validParams);
    expect("error" in result).toBe(false);
    expect("id" in result && result.id).toBe("ts-1");

    // Three coordinated writes: delete old destinations, refresh parent
    // name + itinerarySignature, createMany new destinations with positions.
    expect(prisma.travelDestination.deleteMany).toHaveBeenCalledWith({
      where: { travelSearchId: "ts-1", userId: "user-1" },
    });
    expect(prisma.travelSearch.update).toHaveBeenCalledWith({
      where: { id: "ts-1" },
      data: {
        name: expect.stringContaining("Atlanta, GA"),
        status: "ACTIVE",
        itinerarySignature: expect.any(String),
      },
    });
    const createManyCall = vi.mocked(prisma.travelDestination.createMany).mock.calls[0][0];
    const rows = createManyCall?.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      travelSearchId: "ts-1",
      userId: "user-1",
      position: 0,
      status: "ACTIVE",
      label: validParams.label,
    });
    // No new TravelSearch row created — dashboard position preserved.
    expect(prisma.travelSearch.create).not.toHaveBeenCalled();
  });

  it("returns a clear error when params collide with another active trip (P2002)", async () => {
    // Codex flagged that updateTravelSearch had no P2002 handling; the
    // partial-unique index throws if the new params match another active
    // trip the same user already saved.
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
    } as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on TravelDestination_user_dedup_active",
      { code: "P2002", clientVersion: "test" },
    );
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

    const result = await updateTravelSearch("ts-1", validParams);
    expect("error" in result && result.error).toContain("Another saved trip");
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

  it("flips both parent and destination to ARCHIVED in one transaction", async () => {
    // Archive must update BOTH so the partial-unique index (WHERE
    // status='ACTIVE') stops counting the destination — re-saving the
    // same trip after archive then succeeds.
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);
    vi.mocked(prisma.travelDestination.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    const result = await deleteTravelSearch("ts-1");
    expect("error" in result).toBe(false);
    expect(prisma.travelDestination.updateMany).toHaveBeenCalledWith({
      where: { travelSearchId: "ts-1" },
      data: { status: "ARCHIVED" },
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

describe("restoreTravelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips both parent and destination back to ACTIVE in one transaction", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
      status: "ARCHIVED",
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);
    vi.mocked(prisma.travelDestination.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    const result = await restoreTravelSearch("ts-1");
    expect("success" in result && result.success).toBe(true);
    expect(prisma.travelDestination.updateMany).toHaveBeenCalledWith({
      where: { travelSearchId: "ts-1" },
      data: { status: "ACTIVE" },
    });
    expect(prisma.travelSearch.update).toHaveBeenCalledWith({
      where: { id: "ts-1" },
      data: { status: "ACTIVE" },
    });
  });

  it("returns the trip id on success so the caller can re-adopt it", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
      status: "ARCHIVED",
    } as never);
    vi.mocked(prisma.travelSearch.update).mockResolvedValue({} as never);
    vi.mocked(prisma.travelDestination.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    const result = await restoreTravelSearch("ts-1");
    expect(result).toMatchObject({ success: true, id: "ts-1" });
  });

  it("returns a friendly error on P2002 partial-unique collision", async () => {
    // Between the archive and the undo, the user saved a fresh duplicate.
    // Refusing to clobber is safer than letting the restore succeed and
    // leaving two ACTIVE rows for the same (user, lat, lng, radius, dates).
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
      status: "ARCHIVED",
    } as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "unique violation",
      { code: "P2002", clientVersion: "test" },
    );
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

    const result = await restoreTravelSearch("ts-1");
    expect("error" in result && result.error).toMatch(/duplicate/i);
  });

  it("returns error for wrong owner", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "other-user",
      status: "ARCHIVED",
    } as never);

    const result = await restoreTravelSearch("ts-1");
    expect("error" in result && result.error).toBe("Not authorized");
  });

  it("returns error for non-existent search", async () => {
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue(null);
    const result = await restoreTravelSearch("ts-nonexistent");
    expect("error" in result && result.error).toBe("Search not found");
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await restoreTravelSearch("ts-1");
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

  it("matches on the itinerarySignature computed from coords + radius + dates", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce(null);
    await findExistingSavedSearch(BASE);
    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    const sigIn = (
      call?.where?.itinerarySignature as { in?: string[] } | undefined
    )?.in;
    expect(sigIn).toBeDefined();
    expect(sigIn!.length).toBeGreaterThanOrEqual(1);
    expect(sigIn!.every((s) => /^[a-f0-9]{64}$/.test(s))).toBe(true);
  });

  it("accepts an array radiusKm and builds one signature per radius", async () => {
    // Legacy compat: a user opens /travel?r=137 (pre-tier-snap era saved
    // trip). Page-side snap resolves to 100, but the persisted row is at
    // 137. Caller passes [100, 137] so the lookup finds the legacy row.
    // Since dedup is now signature-based, the lookup builds one signature
    // per distinct radius and matches any of them.
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-legacy",
    } as never);
    const result = await findExistingSavedSearch({ ...BASE, radiusKm: [100, 137] });
    expect(result).toBe("ts-legacy");
    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    const sigIn = (
      call?.where?.itinerarySignature as { in?: string[] } | undefined
    )?.in;
    expect(sigIn).toHaveLength(2);
  });

  it("de-duplicates an array radiusKm when both entries are equal", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce(null);
    await findExistingSavedSearch({ ...BASE, radiusKm: [50, 50] });
    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    const sigIn = (
      call?.where?.itinerarySignature as { in?: string[] } | undefined
    )?.in;
    expect(sigIn).toHaveLength(1);
  });

  it("returns null for unauthenticated users", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null);
    const result = await findExistingSavedSearch(BASE);
    expect(result).toBeNull();
    expect(prisma.travelSearch.findFirst).not.toHaveBeenCalled();
  });

  it("builds an extra placeId-based signature when placeId is provided (#784)", async () => {
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce(null);
    await findExistingSavedSearch({ ...BASE, placeId: "ChIJplace123" });
    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    const sigIn = (
      call?.where?.itinerarySignature as { in?: string[] } | undefined
    )?.in;
    expect(sigIn).toHaveLength(2);
  });

  it("matches a saved row whose coords drifted, via the placeId signature (#784)", async () => {
    const SAVED_PLACE_ID = "ChIJOwg_06VPwokRYv534QaPC8g";
    const driftedLookup = {
      ...BASE,
      latitude: BASE.latitude + 0.0001,
      longitude: BASE.longitude - 0.0001,
      placeId: SAVED_PLACE_ID,
    };

    const { computeItinerarySignature } = await import("@/lib/travel/limits");
    const expectedSavedSig = computeItinerarySignature([
      {
        placeId: SAVED_PLACE_ID,
        // canonicalStop strips coords when placeId is set; values
        // here don't affect the signature output.
        latitude: 0,
        longitude: 0,
        radiusKm: BASE.radiusKm,
        startDate: BASE.startDate,
        endDate: BASE.endDate,
      },
    ]);

    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-place-match",
      destinations: [{ latitude: BASE.latitude, longitude: BASE.longitude }],
    } as never);
    const result = await findExistingSavedSearch(driftedLookup);
    expect(result).toBe("ts-place-match");

    const call = vi.mocked(prisma.travelSearch.findFirst).mock.calls[0][0];
    const sigIn = (
      call?.where?.itinerarySignature as { in?: string[] } | undefined
    )?.in;
    expect(sigIn).toContain(expectedSavedSig);
  });

  it("rejects a placeId-bearing lookup whose coords are far from the matched row (#784)", async () => {
    // Crafted URL pairs Tokyo coords with London's placeId. The
    // placeId-only signature would otherwise resolve to the London
    // saved row and let the page mis-flag a totally different
    // destination as "Saved". Proximity guard rejects this.
    const tampered = {
      ...BASE,
      latitude: 35.6762, // Tokyo
      longitude: 139.6503,
      placeId: "ChIJdd4hrwug2EcRmSrV3Vo6llI", // London City of London
    };
    vi.mocked(prisma.travelSearch.findFirst).mockResolvedValueOnce({
      id: "ts-london",
      // Saved row's actual coords (London) are thousands of km from URL.
      destinations: [{ latitude: 51.5074, longitude: -0.1278 }],
    } as never);
    const result = await findExistingSavedSearch(tampered);
    expect(result).toBeNull();
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
      { latitude: 40, longitude: -74, regionRef: null },    // ~1200km (NYC area)
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
      { latitude: 40, longitude: -74, regionRef: null },
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

describe("saveDraftSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a DRAFT TravelSearch + destinations", async () => {
    vi.mocked(prisma.travelSearch.create).mockResolvedValue({
      id: "draft-1",
      userId: "user-1",
      name: "Atlanta, GA · Apr 14–21",
      status: "DRAFT",
      lastViewedAt: null,
      itinerarySignature: "sig-abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 1 } as never);

    const result = await saveDraftSearch(validParams);

    expect("success" in result).toBe(true);
    expect("id" in result && result.id).toBe("draft-1");

    expect(prisma.travelSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          status: "DRAFT",
          itinerarySignature: expect.any(String),
        }),
      }),
    );
  });

  it("does NOT dedup — two drafts with the same itinerary coexist", async () => {
    vi.mocked(prisma.travelSearch.create)
      .mockResolvedValueOnce({ id: "draft-a" } as never)
      .mockResolvedValueOnce({ id: "draft-b" } as never);
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 1 } as never);

    const first = await saveDraftSearch(validParams);
    const second = await saveDraftSearch(validParams);

    expect("id" in first && first.id).toBe("draft-a");
    expect("id" in second && second.id).toBe("draft-b");
    expect(prisma.travelSearch.findFirst).not.toHaveBeenCalled();
  });

  it("rejects invalid params (>3 stops, out-of-range radius, etc.)", async () => {
    const result = await saveDraftSearch({
      destinations: [validParams, validParams, validParams, validParams],
    });
    expect("error" in result && result.error).toMatch(/at most/i);
  });

  it("requires authentication", async () => {
    vi.mocked(getOrCreateUser).mockResolvedValueOnce(null as never);
    const result = await saveDraftSearch(validParams);
    expect("error" in result && result.error).toBe("Not authenticated");
  });

  it("writes DRAFT child rows — not ACTIVE — to preserve the parent/child status invariant", async () => {
    vi.mocked(prisma.travelSearch.create).mockResolvedValue({ id: "draft-2" } as never);
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 1 } as never);

    await saveDraftSearch(validParams);

    const createCall = vi.mocked(prisma.travelDestination.createMany).mock.calls[0][0];
    const rows = (createCall as { data: Array<{ status: string }> }).data;
    for (const row of rows) {
      expect(row.status).toBe("DRAFT");
    }
  });
});

describe("updateDraftSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: composite where-clause matches (row exists, owned, still DRAFT).
    vi.mocked(prisma.travelSearch.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.travelDestination.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.travelDestination.createMany).mockResolvedValue({ count: 2 } as never);
  });

  it("updateMany payload never includes status — stays DRAFT", async () => {
    const result = await updateDraftSearch("draft-1", {
      destinations: [validParams, validParams],
    });

    expect("id" in result && result.id).toBe("draft-1");
    const call = vi.mocked(prisma.travelSearch.updateMany).mock.calls[0][0];
    expect(call.data).not.toHaveProperty("status");
    // The where clause enforces the tx-scoped guard.
    expect(call.where).toMatchObject({ id: "draft-1", userId: "user-1", status: "DRAFT" });
  });

  it("refuses to mutate non-DRAFT trips", async () => {
    // Guard didn't match. Post-hoc read shows the row is ACTIVE.
    vi.mocked(prisma.travelSearch.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
      status: "ACTIVE",
    } as never);

    const result = await updateDraftSearch("active-1", validParams);
    expect("error" in result && result.error).toBe("Search is not a draft");
    expect(prisma.travelDestination.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to mutate another user's draft", async () => {
    vi.mocked(prisma.travelSearch.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "someone-else",
      status: "DRAFT",
    } as never);

    const result = await updateDraftSearch("draft-1", validParams);
    expect("error" in result && result.error).toBe("Not authorized");
  });

  it("returns Draft not found when id doesn't exist", async () => {
    vi.mocked(prisma.travelSearch.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue(null as never);

    const result = await updateDraftSearch("ghost", validParams);
    expect("error" in result && result.error).toBe("Draft not found");
  });

  it("rolls back when a concurrent archive races between the initial guard and the final recheck", async () => {
    // First updateMany (initial guard) passes. The delete+create run.
    // Then the final updateMany (tail recheck) returns count=0 — the
    // parent was archived mid-flight. Expected: the whole tx throws,
    // surfaces as Search is not a draft.
    vi.mocked(prisma.travelSearch.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)  // initial guard OK
      .mockResolvedValueOnce({ count: 0 } as never); // tail recheck fails
    vi.mocked(prisma.travelSearch.findUnique).mockResolvedValue({
      userId: "user-1",
      status: "ARCHIVED",
    } as never);

    const result = await updateDraftSearch("draft-1", validParams);
    expect("error" in result && result.error).toBe("Search is not a draft");
  });

  it("writes DRAFT child rows on successful update (preserves parent/child invariant)", async () => {
    vi.mocked(prisma.travelSearch.updateMany).mockResolvedValue({ count: 1 } as never);

    await updateDraftSearch("draft-1", validParams);

    const createCall = vi.mocked(prisma.travelDestination.createMany).mock.calls[0][0];
    const rows = (createCall as { data: Array<{ status: string }> }).data;
    for (const row of rows) {
      expect(row.status).toBe("DRAFT");
    }
  });
});
