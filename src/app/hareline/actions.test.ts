import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    event: { findMany: vi.fn() },
  },
}));

// `unstable_cache` is opaque under test — pass through so our findMany mock
// observes every call. Same pattern as other action tests (admin/events,
// admin/kennels).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import { prisma } from "@/lib/db";
import { loadEventsForTimeMode } from "./actions";

const mockFindMany = vi.mocked(prisma.event.findMany);

// Fixed clock so cache-key assertions are deterministic across runs.
// 2026-05-26T12:00:00Z → todayDateStr is "2026-05-26".
const NOW_MS = Date.UTC(2026, 4, 26, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([] as never);
});

describe("loadEventsForTimeMode kennel-scoping (#1560 PR F)", () => {
  it("unfiltered upcoming query keeps `parentEventId: null` (children stay hidden in global list)", async () => {
    await loadEventsForTimeMode("upcoming", NOW_MS);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where).toHaveProperty("parentEventId", null);
    expect(where).not.toHaveProperty("OR");
  });

  it("kennel-scoped query drops `parentEventId: null` and adds kennel OR-match", async () => {
    await loadEventsForTimeMode("upcoming", NOW_MS, ["ggfm"]);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;

    // No parentEventId filter — series children whose primary kennel
    // matches must be visible (GGFM Friday Strawberry Moon case).
    expect(where).not.toHaveProperty("parentEventId");

    // OR clause matches both root kennel and EventKennel co-host rows.
    expect(where.OR).toEqual([
      { kennelId: { in: ["ggfm"] } },
      { eventKennels: { some: { kennelId: { in: ["ggfm"] } } } },
    ]);

    // Other visibility predicates still applied.
    expect(where).toMatchObject({
      status: { not: "CANCELLED" },
      isManualEntry: { not: true },
      isCanonical: true,
      kennel: { isHidden: false },
    });
  });

  it("past mode + kennel filter applies the same drop + OR shape with descending order", async () => {
    await loadEventsForTimeMode("past", NOW_MS, ["nych3"]);

    const call = mockFindMany.mock.calls[0][0];
    const where = call?.where as Record<string, unknown>;

    expect(where).not.toHaveProperty("parentEventId");
    expect(where.OR).toEqual([
      { kennelId: { in: ["nych3"] } },
      { eventKennels: { some: { kennelId: { in: ["nych3"] } } } },
    ]);
    expect(call?.orderBy).toEqual({ date: "desc" });
  });

  it("hits the same cache entry regardless of kennelIds order ([a,b] === [b,a])", async () => {
    // Cache key is built from a sorted-joined string. With unstable_cache
    // stubbed to identity in this suite, we can't observe Next's cache hits
    // directly — but we *can* assert that the underlying findMany sees the
    // same `kennelId: { in: [...] }` shape regardless of caller order, which
    // is the property the sorted key actually protects.
    await loadEventsForTimeMode("upcoming", NOW_MS, ["b", "a"]);
    await loadEventsForTimeMode("upcoming", NOW_MS, ["a", "b"]);

    const first = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    const second = mockFindMany.mock.calls[1][0]?.where as Record<string, unknown>;
    // Both calls produce identical `OR` clauses — i.e. caller order is
    // normalized before it reaches Prisma.
    expect(first.OR).toEqual(second.OR);
  });

  it("empty kennelIds array falls back to the unfiltered code path", async () => {
    await loadEventsForTimeMode("upcoming", NOW_MS, []);

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    // Empty array means "no filter", so parentEventId:null exclusion stays.
    expect(where).toHaveProperty("parentEventId", null);
    expect(where).not.toHaveProperty("OR");
  });

  it("normalizes kennelIds: trims whitespace, drops empties, dedupes", async () => {
    // Same logical filter as ["a", "b"] — verify normalization collapses to
    // the canonical Prisma `IN` shape regardless of caller noise.
    await loadEventsForTimeMode("upcoming", NOW_MS, [" a ", "b", "", "a", "b  "]);

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where.OR).toEqual([
      { kennelId: { in: ["a", "b"] } },
      { eventKennels: { some: { kennelId: { in: ["a", "b"] } } } },
    ]);
  });

  it("caps kennelIds at MAX_KENNEL_FILTER_IDS to bound cache cardinality + IN size", async () => {
    // 60 distinct IDs in → capped at 50 in the query.
    const sixty = Array.from({ length: 60 }, (_, i) => `k${i.toString().padStart(2, "0")}`);
    await loadEventsForTimeMode("upcoming", NOW_MS, sixty);

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    const orClause = where.OR as Array<{ kennelId?: { in: string[] } }>;
    expect(orClause[0].kennelId!.in).toHaveLength(50);
  });

  it("drops children from top-level when their parent is also in the result (avoids double-render)", async () => {
    // NYCH3 5-Boro case: parent + Sat/Sun children all hosted by NYCH3.
    // Both surface from the query when kennel-filtered, but children must
    // not render at the top level when their parent IS in the result —
    // they already appear in the parent's expanded timeline.
    const minimalEvent = (id: string, parentId: string | null, isSeriesParent: boolean) => ({
      id,
      date: new Date("2026-06-26T12:00:00Z"),
      dateUtc: new Date("2026-06-26T22:00:00Z"),
      timezone: "America/New_York",
      kennelId: "nych3",
      runNumber: null,
      title: id,
      haresText: null,
      startTime: null,
      locationName: null,
      locationCity: null,
      status: "SCHEDULED",
      latitude: null,
      longitude: null,
      trailLengthText: null,
      trailLengthMinMiles: null,
      trailLengthMaxMiles: null,
      difficulty: null,
      trailType: null,
      dogFriendly: null,
      prelube: null,
      isSeriesParent,
      parentEventId: parentId,
      endDate: null,
      childEvents: [],
      kennel: { id: "nych3", shortName: "NYCH3", fullName: "NYC", slug: "nych3", region: "NY", country: "USA" },
      eventKennels: [],
    });
    mockFindMany.mockResolvedValueOnce([
      minimalEvent("umbrella", null, true),
      minimalEvent("sat-child", "umbrella", false),
      minimalEvent("sun-child", "umbrella", false),
      // Child whose parent is NOT in result (GGFM Friday case viewed from
      // GGFM's kennel filter). Must NOT be dropped.
      minimalEvent("ggfm-child", "external-parent", false),
    ] as never);

    const result = await loadEventsForTimeMode("upcoming", NOW_MS, ["nych3"]);

    const ids = result.map((e) => e.id);
    expect(ids).toContain("umbrella");
    expect(ids).toContain("ggfm-child"); // parent NOT in result → kept
    expect(ids).not.toContain("sat-child"); // parent IS in result → dropped
    expect(ids).not.toContain("sun-child"); // parent IS in result → dropped
  });
});
