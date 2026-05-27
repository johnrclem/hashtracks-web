import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  normalizeTitleForCluster,
  clusterGroupKey,
  isConsecutiveCluster,
  splitIntoConsecutiveRuns,
  linkSameTitleConsecutiveClusters,
} from "./same-title-cluster";

// ──────────────────────────────────────────────────────────────────────
// Pure-function unit tests
// ──────────────────────────────────────────────────────────────────────

describe("normalizeTitleForCluster", () => {
  it("lowercases + strips run numbers + punctuation", () => {
    expect(
      normalizeTitleForCluster("BMPH3: Trail #2051 – Belgian Nash Hash 2026 Pub Crawl!"),
    ).toBe("bmph3 belgian nash hash pub crawl!");
  });
  it("strips standalone trail keyword", () => {
    expect(normalizeTitleForCluster("InterScandi 2026 Oslo Trail")).toBe("interscandi oslo");
  });
  it("collapses multi-spaces and trims", () => {
    expect(normalizeTitleForCluster("  Foo   Bar  ")).toBe("foo bar");
  });
});

describe("clusterGroupKey", () => {
  it("returns first 4 tokens", () => {
    expect(clusterGroupKey("bmph3 belgian nash hash pub crawl!")).toBe("bmph3 belgian nash hash");
  });
  it("returns null for fewer than 2 tokens", () => {
    expect(clusterGroupKey("interscandi")).toBeNull();
  });
  it("returns null for short keys (<8 chars)", () => {
    // "a b c d" = 7 chars total
    expect(clusterGroupKey("a b c d")).toBeNull();
  });
  it("accepts 2-token keys when long enough", () => {
    expect(clusterGroupKey("interscandi oslo")).toBe("interscandi oslo");
  });
});

describe("isConsecutiveCluster (per-run span check)", () => {
  const ev = (d: string) => ({
    id: d,
    date: new Date(`${d}T12:00:00Z`),
    title: "Foo",
    isSeriesParent: false,
    parentEventId: null,
  });

  it("returns true for 3 consecutive days", () => {
    expect(isConsecutiveCluster([ev("2026-06-12"), ev("2026-06-13"), ev("2026-06-14")])).toBe(true);
  });
  it("returns false when total span exceeds 7 days", () => {
    expect(isConsecutiveCluster([ev("2026-05-29"), ev("2026-06-06")])).toBe(false);
  });
  it("returns false for single event", () => {
    expect(isConsecutiveCluster([ev("2026-05-29")])).toBe(false);
  });
});

describe("splitIntoConsecutiveRuns", () => {
  const ev = (d: string) => ({
    id: d,
    date: new Date(`${d}T12:00:00Z`),
    title: "Foo",
    isSeriesParent: false,
    parentEventId: null,
  });

  it("returns one run for a tight cluster", () => {
    const runs = splitIntoConsecutiveRuns([ev("2026-06-12"), ev("2026-06-13"), ev("2026-06-14")]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });
  it("allows 2-day gap (Fri/Sat/Sun + Mon recovery as one run)", () => {
    const runs = splitIntoConsecutiveRuns([ev("2026-05-29"), ev("2026-05-30"), ev("2026-06-01")]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });
  it("splits at gaps larger than 2 days", () => {
    const runs = splitIntoConsecutiveRuns([ev("2026-05-29"), ev("2026-06-02")]);
    expect(runs).toHaveLength(2);
  });
  it("Codex P2 case: annual recurrence splits into independent runs", () => {
    // BMPH3 Belgian Nash Hash 2026 (Jul 10-12) + same series 2027 (Jul 9-11)
    const runs = splitIntoConsecutiveRuns([
      ev("2026-07-10"), ev("2026-07-11"), ev("2026-07-12"),
      ev("2027-07-09"), ev("2027-07-10"), ev("2027-07-11"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(3);
    expect(runs[1]).toHaveLength(3);
  });
});

// ──────────────────────────────────────────────────────────────────────
// linkSameTitleConsecutiveClusters integration (Prisma-mocked)
// ──────────────────────────────────────────────────────────────────────

describe("linkSameTitleConsecutiveClusters", () => {
  type EvShape = {
    id: string;
    date: Date;
    title: string;
    kennelId: string;
    isSeriesParent: boolean;
    parentEventId: string | null;
  };
  let mockEvents: EvShape[];
  let updates: Array<{ where: { id?: string; id_in?: string[] }; data: Record<string, unknown> }>;
  let mockPrisma: never;

  beforeEach(() => {
    mockEvents = [];
    updates = [];
    mockPrisma = {
      event: {
        findMany: vi.fn(async () => mockEvents),
        // Prisma's batch-API calls (used inside `$transaction([...])`) capture
        // intent objects rather than firing; the mock just records the call
        // shape so the test can assert it. `$transaction` then "awaits" the
        // collected calls.
        update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ where, data });
          return { ...mockEvents.find((e) => e.id === where.id), ...data };
        }),
        updateMany: vi.fn(({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
          updates.push({ where: { id_in: where.id.in }, data });
          return { count: where.id.in.length };
        }),
      },
      // `$transaction` accepts an array of (already-awaited) calls in our
      // mock; resolve to an array of their resolutions.
      $transaction: vi.fn(async (calls: unknown[]) => calls),
    } as never;
    evCounter = 0;
  });

  // Monotonic counter for default test IDs — deterministic across runs and
  // doesn't trip Sonar S2245 (pseudorandom-in-tests is harmless but the rule
  // doesn't distinguish). Most tests pass explicit `id` overrides anyway.
  let evCounter = 0;
  const ev = (overrides: Partial<EvShape>): EvShape => ({
    id: `id-${++evCounter}`,
    date: new Date("2026-06-12T12:00:00Z"),
    title: "Default",
    kennelId: "kennel-1",
    isSeriesParent: false,
    parentEventId: null,
    ...overrides,
  });

  it("links a 3-day InterScandi-style cluster", async () => {
    mockEvents = [
      ev({ id: "isc-1", date: new Date("2026-06-12T12:00:00Z"), title: "InterScandi 2026 Oslo" }),
      ev({ id: "isc-2", date: new Date("2026-06-13T12:00:00Z"), title: "InterScandi 2026 Oslo" }),
      ev({ id: "isc-3", date: new Date("2026-06-14T12:00:00Z"), title: "InterScandi 2026 Oslo" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1"]));
    expect(result.clustersLinked).toBe(1);
    expect(result.eventsLinked).toBe(3);
    // Parent update: isSeriesParent + endDate
    const parentUpdate = updates.find((u) => "id" in u.where && u.where.id === "isc-1");
    expect(parentUpdate?.data).toMatchObject({ isSeriesParent: true, parentEventId: null });
    expect((parentUpdate?.data.endDate as Date).toISOString().slice(0, 10)).toBe("2026-06-14");
    // Children update: parentEventId set
    const childrenUpdate = updates.find((u) => "id_in" in u.where);
    expect(childrenUpdate?.where.id_in).toEqual(["isc-2", "isc-3"]);
    expect(childrenUpdate?.data).toMatchObject({ parentEventId: "isc-1", isSeriesParent: false });
  });

  it("links BMPH3 per-day-suffix cluster via first-4-token key", async () => {
    mockEvents = [
      ev({ id: "bm-1", date: new Date("2026-07-10T12:00:00Z"), title: "BMPH3: Trail #2051 – Belgian Nash Hash 2026 Pub Crawl!" }),
      ev({ id: "bm-2", date: new Date("2026-07-11T12:00:00Z"), title: "BMPH3: Trail #2052 – Belgian Nash Hash 2026 Trail!" }),
      ev({ id: "bm-3", date: new Date("2026-07-12T12:00:00Z"), title: "BMPH3: Trail #2053 – Belgian Nash Hash 2026 Hangover Trail!" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1"]));
    expect(result.clustersLinked).toBe(1);
    expect(result.eventsLinked).toBe(3);
  });

  it("skips clusters where any member is already a series parent", async () => {
    mockEvents = [
      ev({ id: "a", date: new Date("2026-06-12T12:00:00Z"), title: "Already 2026 Linked", isSeriesParent: true }),
      ev({ id: "b", date: new Date("2026-06-13T12:00:00Z"), title: "Already 2026 Linked" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1"]));
    expect(result.clustersLinked).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("skips clusters where any member already has a parentEventId", async () => {
    mockEvents = [
      ev({ id: "a", date: new Date("2026-06-12T12:00:00Z"), title: "Already 2026 Child", parentEventId: "elsewhere" }),
      ev({ id: "b", date: new Date("2026-06-13T12:00:00Z"), title: "Already 2026 Child" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1"]));
    expect(result.clustersLinked).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("doesn't cluster across different kennels even with same title", async () => {
    mockEvents = [
      ev({ id: "k1-1", date: new Date("2026-06-12T12:00:00Z"), title: "Some Event 2026 Title", kennelId: "kennel-1" }),
      ev({ id: "k2-1", date: new Date("2026-06-13T12:00:00Z"), title: "Some Event 2026 Title", kennelId: "kennel-2" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1", "kennel-2"]));
    expect(result.clustersLinked).toBe(0);
  });

  it("returns early on empty kennel set without querying the DB", async () => {
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set());
    expect(result.clustersLinked).toBe(0);
    expect((mockPrisma as { event: { findMany: { mock: { calls: unknown[] } } } }).event.findMany.mock.calls).toHaveLength(0);
  });

  it("skips clusters that span more than 7 days", async () => {
    mockEvents = [
      ev({ id: "a", date: new Date("2026-06-01T12:00:00Z"), title: "Weekly Series 2026 Title" }),
      ev({ id: "b", date: new Date("2026-06-08T12:00:00Z"), title: "Weekly Series 2026 Title" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1"]));
    expect(result.clustersLinked).toBe(0);
  });

  it("Codex P2: links 2026 cluster AND 2027 recurrence as separate series", async () => {
    // BMPH3 Belgian Nash Hash 2026 + 2027 — share group key "bmph3 belgian
    // nash hash" but year-apart gap means they should be independent runs.
    // Before PR fix: whole-bucket span check rejected both. After: each
    // weekend links independently.
    mockEvents = [
      ev({ id: "y26-1", date: new Date("2026-07-10T12:00:00Z"), title: "BMPH3 Belgian Nash Hash 2026 Pub Crawl" }),
      ev({ id: "y26-2", date: new Date("2026-07-11T12:00:00Z"), title: "BMPH3 Belgian Nash Hash 2026 Trail" }),
      ev({ id: "y26-3", date: new Date("2026-07-12T12:00:00Z"), title: "BMPH3 Belgian Nash Hash 2026 Hangover" }),
      ev({ id: "y27-1", date: new Date("2027-07-09T12:00:00Z"), title: "BMPH3 Belgian Nash Hash 2027 Pub Crawl" }),
      ev({ id: "y27-2", date: new Date("2027-07-10T12:00:00Z"), title: "BMPH3 Belgian Nash Hash 2027 Trail" }),
      ev({ id: "y27-3", date: new Date("2027-07-11T12:00:00Z"), title: "BMPH3 Belgian Nash Hash 2027 Hangover" }),
    ];
    const result = await linkSameTitleConsecutiveClusters(mockPrisma, new Set(["kennel-1"]));
    expect(result.clustersLinked).toBe(2);
    expect(result.eventsLinked).toBe(6);
    // Confirm two distinct umbrellas (y26-1 and y27-1).
    const parentUpdates = updates.filter((u) => "id" in u.where && u.data.isSeriesParent === true);
    expect(
      parentUpdates.map((u) => (u.where as { id: string }).id).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["y26-1", "y27-1"]);
  });
});
