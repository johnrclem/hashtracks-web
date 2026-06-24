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
import { loadEventsForTimeMode, loadMorePastEvents } from "./actions";
import { PAST_EVENTS_LIMIT } from "./constants";

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
    // Past mode carries a deterministic `id desc` tiebreak so cursor
    // back-pagination (`loadMorePastEvents`) has a well-defined boundary.
    expect(call?.orderBy).toEqual([{ date: "desc" }, { id: "desc" }]);
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
      cost: null,
      isSeriesParent,
      parentEventId: parentId,
      endDate: null,
      childEvents: [],
      kennel: { id: "nych3", shortName: "NYCH3", fullName: "NYC", slug: "nych3", region: "NY", country: "USA" },
      eventKennels: [],
    });
    mockFindMany.mockResolvedValueOnce([
      { ...minimalEvent("umbrella", null, true), cost: "$7" },
      minimalEvent("sat-child", "umbrella", false),
      minimalEvent("sun-child", "umbrella", false),
      // Child whose parent is NOT in result (GGFM Friday case viewed from
      // GGFM's kennel filter). Must NOT be dropped.
      minimalEvent("ggfm-child", "external-parent", false),
    ] as never);

    const { events: result } = await loadEventsForTimeMode("upcoming", NOW_MS, ["nych3"]);

    const ids = result.map((e) => e.id);
    expect(ids).toContain("umbrella");
    expect(ids).toContain("ggfm-child"); // parent NOT in result → kept
    expect(ids).not.toContain("sat-child"); // parent IS in result → dropped
    expect(ids).not.toContain("sun-child"); // parent IS in result → dropped
    expect(result.find((e) => e.id === "umbrella")?.cost).toBe("$7"); // cost flows through slim payload
  });
});

describe("loadEventsForTimeMode first-page hasMore (raw page fullness)", () => {
  const minimalRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    date: new Date("2026-05-20T12:00:00Z"),
    dateUtc: new Date("2026-05-20T22:00:00Z"),
    timezone: "America/New_York",
    kennelId: "sdh3",
    runNumber: null,
    title: id,
    eventLabel: null,
    haresText: null,
    startTime: null,
    endTime: null,
    locationName: null,
    locationCity: null,
    status: "CONFIRMED",
    latitude: null,
    longitude: null,
    trailLengthText: null,
    trailLengthMinMiles: null,
    trailLengthMaxMiles: null,
    difficulty: null,
    trailType: null,
    dogFriendly: null,
    prelube: null,
    cost: null,
    isSeriesParent: false,
    parentEventId: null,
    endDate: null,
    childEvents: [],
    kennel: { id: "sdh3", shortName: "SDH3", fullName: "San Diego", slug: "sdh3", region: "CA", country: "USA" },
    eventKennels: [],
    ...overrides,
  });

  it("hasMore=true when the past page is full, even when dedup trims the returned length", async () => {
    // A full raw past page where a parent + its child collapse to one.
    const rows = [
      minimalRow("umbrella", { isSeriesParent: true }),
      minimalRow("child", { parentEventId: "umbrella" }),
      ...Array.from({ length: PAST_EVENTS_LIMIT - 2 }, (_, i) => minimalRow(`s${i}`)),
    ];
    expect(rows).toHaveLength(PAST_EVENTS_LIMIT);
    mockFindMany.mockResolvedValueOnce(rows as never);

    const { events, hasMore } = await loadEventsForTimeMode("past", NOW_MS, ["sdh3"]);
    // Deduped below the limit...
    expect(events).toHaveLength(PAST_EVENTS_LIMIT - 1);
    expect(events.map((e) => e.id)).not.toContain("child");
    // ...but the RAW page was full, so older events may remain.
    expect(hasMore).toBe(true);
  });

  it("hasMore=false on a short past page (end of archive)", async () => {
    mockFindMany.mockResolvedValueOnce([minimalRow("e1"), minimalRow("e2")] as never);

    const { hasMore } = await loadEventsForTimeMode("past", NOW_MS);
    expect(hasMore).toBe(false);
  });
});

describe("loadMorePastEvents cursor back-pagination", () => {
  const minimalRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    date: new Date("2026-03-15T12:00:00Z"),
    dateUtc: new Date("2026-03-15T22:00:00Z"),
    timezone: "America/New_York",
    kennelId: "sdh3",
    runNumber: null,
    title: id,
    eventLabel: null,
    haresText: null,
    startTime: null,
    endTime: null,
    locationName: null,
    locationCity: null,
    status: "CONFIRMED",
    latitude: null,
    longitude: null,
    trailLengthText: null,
    trailLengthMinMiles: null,
    trailLengthMaxMiles: null,
    difficulty: null,
    trailType: null,
    dogFriendly: null,
    prelube: null,
    cost: null,
    isSeriesParent: false,
    parentEventId: null,
    endDate: null,
    childEvents: [],
    kennel: { id: "sdh3", shortName: "SDH3", fullName: "San Diego", slug: "sdh3", region: "CA", country: "USA" },
    eventKennels: [],
    ...overrides,
  });

  it("queries with cursor, skip:1, take:PAST_EVENTS_LIMIT and compound desc order", async () => {
    await loadMorePastEvents("cursor-id");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const call = mockFindMany.mock.calls[0][0];
    expect(call?.cursor).toEqual({ id: "cursor-id" });
    expect(call?.skip).toBe(1);
    expect(call?.take).toBe(PAST_EVENTS_LIMIT);
    expect(call?.orderBy).toEqual([{ date: "desc" }, { id: "desc" }]);
  });

  it("unfiltered cursor query keeps parentEventId:null + a past date ceiling, no OR", async () => {
    await loadMorePastEvents("cursor-id");

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where).toHaveProperty("parentEventId", null);
    expect(where).not.toHaveProperty("OR");
    const dateFilter = where.date as { lt?: Date };
    expect(dateFilter.lt).toBeInstanceOf(Date); // past ceiling, mirrors page one
  });

  it("kennel-scoped cursor query drops parentEventId:null and adds kennel OR-match", async () => {
    await loadMorePastEvents("cursor-id", ["sdh3"]);

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("parentEventId");
    expect(where.OR).toEqual([
      { kennelId: { in: ["sdh3"] } },
      { eventKennels: { some: { kennelId: { in: ["sdh3"] } } } },
    ]);
  });

  it("returns the slim mapped shape (date → ISO string, dateUtc → Date)", async () => {
    mockFindMany.mockResolvedValueOnce([minimalRow("e1")] as never);

    const { events } = await loadMorePastEvents("cursor-id");
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("e1");
    expect(events[0].date).toBe("2026-03-15T12:00:00.000Z");
    expect(events[0].dateUtc).toBeInstanceOf(Date);
  });

  it("hasMore=true on a full raw page even when dedup trims the returned length", async () => {
    // A full page where a parent + its child collapse to one returned row.
    const rows = [
      minimalRow("umbrella", { isSeriesParent: true }),
      minimalRow("child", { parentEventId: "umbrella" }),
      ...Array.from({ length: PAST_EVENTS_LIMIT - 2 }, (_, i) => minimalRow(`s${i}`)),
    ];
    expect(rows).toHaveLength(PAST_EVENTS_LIMIT);
    mockFindMany.mockResolvedValueOnce(rows as never);

    const { events, hasMore } = await loadMorePastEvents("cursor-id", ["sdh3"]);
    // child deduped out (parent present) → one fewer than the raw page...
    expect(events).toHaveLength(PAST_EVENTS_LIMIT - 1);
    expect(events.map((e) => e.id)).not.toContain("child");
    // ...but hasMore stays true because the RAW page was full.
    expect(hasMore).toBe(true);
  });

  it("hasMore=false on a short page (end of archive)", async () => {
    mockFindMany.mockResolvedValueOnce([minimalRow("e1"), minimalRow("e2")] as never);

    const { hasMore } = await loadMorePastEvents("cursor-id");
    expect(hasMore).toBe(false);
  });

  it("empty cursorId short-circuits with no query", async () => {
    const res = await loadMorePastEvents("");
    expect(res).toEqual({ events: [], hasMore: false });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("propagates real query failures (so the client's retry UI engages, not a false end-of-list)", async () => {
    // A genuinely missing cursor returns [] (correlated-subquery cursor), but a
    // real dependency failure must surface — it must NOT be disguised as a
    // normal archive boundary (Codex review).
    mockFindMany.mockRejectedValueOnce(new Error("db timeout"));

    await expect(loadMorePastEvents("cursor-id")).rejects.toThrow("db timeout");
  });

  it("returns end-of-list naturally when the cursor row matches nothing (empty result)", async () => {
    // Missing/hard-deleted cursor → correlated subquery matches no rows → [].
    mockFindMany.mockResolvedValueOnce([] as never);

    const res = await loadMorePastEvents("ghost-id");
    expect(res).toEqual({ events: [], hasMore: false });
  });
});
