import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    scrapeLog: { findMany: vi.fn() },
    alert: { findMany: vi.fn(), update: vi.fn() },
    kennel: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { analyzeHealth, autoResolveCleared } from "./health";

const mockScrapeLogFind = vi.mocked(prisma.scrapeLog.findMany);
const mockKennelFindMany = vi.mocked(prisma.kennel.findMany);

const baseFillRates = { title: 100, location: 80, hares: 50, startTime: 90, runNumber: 70 };

function baseInput(overrides = {}) {
  return {
    eventsFound: 10,
    scrapeFailed: false,
    errors: [],
    unmatchedTags: [],
    fillRates: baseFillRates,
    ...overrides,
  };
}

// Baseline scrape log entries for rolling-window comparison
const baselineEntries = Array.from({ length: 3 }, () => ({
  eventsFound: 10,
  unmatchedTags: [],
  fillRateTitle: 100,
  fillRateLocation: 80,
  fillRateHares: 50,
  fillRateStartTime: 90,
  fillRateRunNumber: 70,
  structureHash: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return 3 successful baseline scrapes + empty recent-all
  mockScrapeLogFind
    .mockResolvedValueOnce(baselineEntries as never)  // recentSuccessful
    .mockResolvedValueOnce([] as never);               // recentAll
  // Default: no kennel lookups needed; tests that exercise RECONCILE_SUPPRESSED
  // override this with their own mockResolvedValueOnce.
  mockKennelFindMany.mockResolvedValue([] as never);
});

describe("analyzeHealth", () => {
  it("returns HEALTHY when no issues", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput());
    expect(result.healthStatus).toBe("HEALTHY");
    expect(result.alerts).toHaveLength(0);
  });

  it("returns FAILING on scrape failure", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      scrapeFailed: true,
      errors: ["Connection refused"],
    }));
    expect(result.healthStatus).toBe("FAILING");
    expect(result.alerts.some(a => a.type === "SCRAPE_FAILURE")).toBe(true);
  });

  it("generates EVENT_COUNT_ANOMALY for zero events", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      eventsFound: 0,
    }));
    expect(result.alerts.some(a => a.type === "EVENT_COUNT_ANOMALY")).toBe(true);
  });

  it("generates UNMATCHED_TAGS for novel tags", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      unmatchedTags: ["NewKennel"],
    }));
    const alert = result.alerts.find(a => a.type === "UNMATCHED_TAGS");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("WARNING");
    expect(result.healthStatus).toBe("DEGRADED");
    expect((alert!.context!.tags as string[])).toContain("NewKennel");
  });

  it("includes all check types in checkedTypes when baseline exists", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput());
    expect(result.checkedTypes).toContain("SCRAPE_FAILURE");
    expect(result.checkedTypes).toContain("CONSECUTIVE_FAILURES");
    expect(result.checkedTypes).toContain("EVENT_COUNT_ANOMALY");
    expect(result.checkedTypes).toContain("FIELD_FILL_DROP");
    expect(result.checkedTypes).toContain("STRUCTURE_CHANGE");
    expect(result.checkedTypes).toContain("UNMATCHED_TAGS");
    expect(result.checkedTypes).toContain("SOURCE_KENNEL_MISMATCH");
    // RECONCILE_SUPPRESSED is only checked when reconcile actually ran —
    // see the dedicated describe block below for gated behavior.
    expect(result.checkedTypes).not.toContain("RECONCILE_SUPPRESSED");
  });

  it("omits trend check types from checkedTypes when no baseline", async () => {
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // no baseline
      .mockResolvedValueOnce([] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput());
    expect(result.checkedTypes).toContain("SCRAPE_FAILURE");
    expect(result.checkedTypes).toContain("CONSECUTIVE_FAILURES");
    expect(result.checkedTypes).toContain("SOURCE_KENNEL_MISMATCH");
    // Trend checks not evaluated without baseline
    expect(result.checkedTypes).not.toContain("EVENT_COUNT_ANOMALY");
    expect(result.checkedTypes).not.toContain("FIELD_FILL_DROP");
    expect(result.checkedTypes).not.toContain("STRUCTURE_CHANGE");
    expect(result.checkedTypes).not.toContain("UNMATCHED_TAGS");
  });

  it("does not generate UNMATCHED_TAGS for previously seen tags", async () => {
    // Baseline already had this tag
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce(
        baselineEntries.map(e => ({ ...e, unmatchedTags: ["OldTag"] })) as never,
      )
      .mockResolvedValueOnce([] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      unmatchedTags: ["OldTag"],
    }));
    expect(result.alerts.find(a => a.type === "UNMATCHED_TAGS")).toBeUndefined();
  });
});

describe("SOURCE_KENNEL_MISMATCH alerts", () => {
  it("generates alert when blockedTags is non-empty", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      blockedTags: ["BoH3", "SomeH3"],
    }));

    const alert = result.alerts.find(a => a.type === "SOURCE_KENNEL_MISMATCH");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("WARNING");
    expect(alert!.title).toContain("2 kennel tags blocked");
    expect((alert!.context!.tags as string[])).toEqual(["BoH3", "SomeH3"]);
  });

  it("does not generate alert when blockedTags is empty", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      blockedTags: [],
    }));
    expect(result.alerts.find(a => a.type === "SOURCE_KENNEL_MISMATCH")).toBeUndefined();
  });

  it("does not generate alert when blockedTags is undefined", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput());
    expect(result.alerts.find(a => a.type === "SOURCE_KENNEL_MISMATCH")).toBeUndefined();
  });

  it("generates alert even without baseline data", async () => {
    // No prior scrapes
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // no baseline
      .mockResolvedValueOnce([] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      blockedTags: ["BoH3"],
    }));
    const alert = result.alerts.find(a => a.type === "SOURCE_KENNEL_MISMATCH");
    expect(alert).toBeDefined();
  });

  it("sets DEGRADED status when blocked tags cause WARNING", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      blockedTags: ["BoH3"],
    }));
    expect(result.healthStatus).toBe("DEGRADED");
  });

  it("uses singular grammar for one blocked tag", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      blockedTags: ["BoH3"],
    }));
    const alert = result.alerts.find(a => a.type === "SOURCE_KENNEL_MISMATCH");
    expect(alert!.title).toContain("1 kennel tag blocked");
    expect(alert!.title).not.toContain("tags");
  });
});

describe("RECONCILE_SUPPRESSED alerts", () => {
  it("does not check or alert when reconcile did not run", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileSuppressedKennels: ["knl_1"],
      // reconcileEvaluated omitted — simulates scrape where reconcile was skipped
    }));
    expect(result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED")).toBeUndefined();
    expect(result.checkedTypes).not.toContain("RECONCILE_SUPPRESSED");
    expect(mockKennelFindMany).not.toHaveBeenCalled();
  });

  it("registers check but skips alert when reconcile ran with no suppression", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileEvaluated: true,
      reconcileSuppressedKennels: [],
    }));
    expect(result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED")).toBeUndefined();
    expect(result.checkedTypes).toContain("RECONCILE_SUPPRESSED");
    expect(mockKennelFindMany).not.toHaveBeenCalled();
  });

  it("registers check but skips alert when reconcile ran with undefined suppression", async () => {
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileEvaluated: true,
    }));
    expect(result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED")).toBeUndefined();
    expect(result.checkedTypes).toContain("RECONCILE_SUPPRESSED");
    expect(mockKennelFindMany).not.toHaveBeenCalled();
  });

  it("generates one WARNING alert with resolved shortNames and kennelsSuppressed context", async () => {
    mockKennelFindMany.mockReset();
    mockKennelFindMany.mockResolvedValueOnce([
      { id: "knl_1", shortName: "NYCH3" },
      { id: "knl_2", shortName: "BFM" },
    ] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileEvaluated: true,
      reconcileSuppressedKennels: ["knl_1", "knl_2"],
    }));

    const alert = result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("WARNING");
    expect(alert!.title).toContain("2 kennels");
    expect(alert!.details).toContain("NYCH3");
    expect(alert!.details).toContain("BFM");
    expect((alert!.context!.kennelsSuppressed as string[])).toEqual(["knl_1", "knl_2"]);
    expect(result.healthStatus).toBe("DEGRADED");
  });

  it("uses singular grammar for one suppressed kennel", async () => {
    mockKennelFindMany.mockReset();
    mockKennelFindMany.mockResolvedValueOnce([
      { id: "knl_1", shortName: "NYCH3" },
    ] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileEvaluated: true,
      reconcileSuppressedKennels: ["knl_1"],
    }));

    const alert = result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED");
    expect(alert!.title).toContain("1 kennel");
    expect(alert!.title).not.toMatch(/\bkennels\b/);
  });

  it("falls back to raw kennel ID when shortName lookup misses", async () => {
    mockKennelFindMany.mockReset();
    mockKennelFindMany.mockResolvedValueOnce([] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileEvaluated: true,
      reconcileSuppressedKennels: ["knl_orphan"],
    }));

    const alert = result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED");
    expect(alert).toBeDefined();
    expect(alert!.details).toContain("knl_orphan");
    expect((alert!.context!.kennelsSuppressed as string[])).toEqual(["knl_orphan"]);
  });

  it("falls back to raw IDs without rejecting when kennel lookup throws", async () => {
    mockKennelFindMany.mockReset();
    mockKennelFindMany.mockRejectedValueOnce(new Error("transient DB error") as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      reconcileEvaluated: true,
      reconcileSuppressedKennels: ["knl_1", "knl_2"],
    }));

    const alert = result.alerts.find((a) => a.type === "RECONCILE_SUPPRESSED");
    expect(alert).toBeDefined();
    expect(alert!.details).toContain("knl_1");
    expect(alert!.details).toContain("knl_2");
    expect((alert!.context!.kennelsSuppressed as string[])).toEqual(["knl_1", "knl_2"]);
  });
});

const mockAlertFindMany = vi.mocked(prisma.alert.findMany);
const mockAlertUpdate = vi.mocked(prisma.alert.update);

describe("autoResolveCleared", () => {
  beforeEach(() => {
    mockAlertFindMany.mockReset();
    mockAlertUpdate.mockReset();
  });

  it("resolves OPEN alerts whose type is not in candidate set", async () => {
    mockAlertFindMany.mockResolvedValueOnce([
      { id: "alert_1", type: "EVENT_COUNT_ANOMALY", details: "Old details" },
    ] as never);
    mockAlertUpdate.mockResolvedValue({} as never);

    const count = await autoResolveCleared("src_1", new Set(["SCRAPE_FAILURE"]), false);

    expect(count).toBe(1);
    expect(mockAlertUpdate).toHaveBeenCalledWith({
      where: { id: "alert_1" },
      data: expect.objectContaining({
        status: "RESOLVED",
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it("does not resolve alerts whose type IS in candidate set", async () => {
    mockAlertFindMany.mockResolvedValueOnce([
      { id: "alert_1", type: "SCRAPE_FAILURE", details: "Still failing" },
    ] as never);

    const count = await autoResolveCleared("src_1", new Set(["SCRAPE_FAILURE"]), false);

    expect(count).toBe(0);
    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it("skips entirely when scrapeFailed is true", async () => {
    const count = await autoResolveCleared("src_1", new Set(), true);

    expect(count).toBe(0);
    expect(mockAlertFindMany).not.toHaveBeenCalled();
  });

  it("resolves multiple alerts of different types (partial)", async () => {
    mockAlertFindMany.mockResolvedValueOnce([
      { id: "alert_1", type: "EVENT_COUNT_ANOMALY", details: "Drop" },
      { id: "alert_2", type: "FIELD_FILL_DROP", details: "Fill drop" },
      { id: "alert_3", type: "UNMATCHED_TAGS", details: "Tags" },
    ] as never);
    mockAlertUpdate.mockResolvedValue({} as never);

    const count = await autoResolveCleared("src_1", new Set(["UNMATCHED_TAGS"]), false);

    expect(count).toBe(2);
    expect(mockAlertUpdate).toHaveBeenCalledTimes(2);
    const updatedIds = mockAlertUpdate.mock.calls.map(c => c[0].where.id);
    expect(updatedIds).toContain("alert_1");
    expect(updatedIds).toContain("alert_2");
    expect(updatedIds).not.toContain("alert_3");
  });

  it("handles null details gracefully", async () => {
    mockAlertFindMany.mockResolvedValueOnce([
      { id: "alert_1", type: "EVENT_COUNT_ANOMALY", details: null },
    ] as never);
    mockAlertUpdate.mockResolvedValue({} as never);

    const count = await autoResolveCleared("src_1", new Set(), false);

    expect(count).toBe(1);
    expect(mockAlertUpdate).toHaveBeenCalledWith({
      where: { id: "alert_1" },
      data: expect.objectContaining({
        details: expect.stringContaining("[Auto-resolved:"),
      }),
    });
  });

  it("does not resolve alerts whose type was not in checkedTypes", async () => {
    mockAlertFindMany.mockResolvedValueOnce([
      { id: "alert_1", type: "EVENT_COUNT_ANOMALY", details: "Drop" },
      { id: "alert_2", type: "SCRAPE_FAILURE", details: "Fail" },
    ] as never);
    mockAlertUpdate.mockResolvedValue({} as never);

    // Only SCRAPE_FAILURE was checked; EVENT_COUNT_ANOMALY was not evaluated
    const checkedTypes = new Set(["SCRAPE_FAILURE"]);
    const count = await autoResolveCleared("src_1", new Set(), false, checkedTypes);

    expect(count).toBe(1);
    expect(mockAlertUpdate).toHaveBeenCalledTimes(1);
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "alert_2" } }),
    );
  });

  it("resolves all cleared alerts when checkedTypes is omitted", async () => {
    mockAlertFindMany.mockResolvedValueOnce([
      { id: "alert_1", type: "EVENT_COUNT_ANOMALY", details: "Drop" },
      { id: "alert_2", type: "FIELD_FILL_DROP", details: "Fill" },
    ] as never);
    mockAlertUpdate.mockResolvedValue({} as never);

    // No checkedTypes passed — backward-compatible, resolves all non-candidate
    const count = await autoResolveCleared("src_1", new Set(), false);

    expect(count).toBe(2);
    expect(mockAlertUpdate).toHaveBeenCalledTimes(2);
  });
});
