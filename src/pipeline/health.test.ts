import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    scrapeLog: { findMany: vi.fn(), findFirst: vi.fn() },
    alert: { findMany: vi.fn(), update: vi.fn() },
    kennel: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { analyzeHealth, autoResolveCleared } from "./health";

const mockScrapeLogFind = vi.mocked(prisma.scrapeLog.findMany);
const mockScrapeLogFindFirst = vi.mocked(prisma.scrapeLog.findFirst);
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

  it("registers trend types in checkedTypes even when baseline is empty (#1115)", async () => {
    // Trend types are registered as checked on any successful scrape so
    // that stale alerts auto-resolve when a regime reset wipes the
    // baseline. The actual checks short-circuit when there's no baseline.
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // no baseline
      .mockResolvedValueOnce([] as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput());
    expect(result.checkedTypes).toContain("SCRAPE_FAILURE");
    expect(result.checkedTypes).toContain("CONSECUTIVE_FAILURES");
    expect(result.checkedTypes).toContain("SOURCE_KENNEL_MISMATCH");
    expect(result.checkedTypes).toContain("EVENT_COUNT_ANOMALY");
    expect(result.checkedTypes).toContain("FIELD_FILL_DROP");
    expect(result.checkedTypes).toContain("STRUCTURE_CHANGE");
    expect(result.checkedTypes).toContain("UNMATCHED_TAGS");
    // Verify the actual check did NOT fire alerts (baseline-empty short-circuit)
    expect(result.alerts.find((a) => a.type === "EVENT_COUNT_ANOMALY")).toBeUndefined();
    expect(result.alerts.find((a) => a.type === "FIELD_FILL_DROP")).toBeUndefined();
  });

  it("omits trend types from checkedTypes when scrape fails", async () => {
    // On scrape failure, trend types must NOT be marked checked — auto-resolve
    // would otherwise wrongly clear stale CRITICAL alerts during an outage.
    const result = await analyzeHealth("src_1", "log_1", baseInput({
      scrapeFailed: true,
      errors: ["timeout"],
    }));
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

describe("regime-aware baseline (#1115)", () => {
  it("filters baseline by configHash equality (no OR-on-null) when currentConfigHash is provided", async () => {
    await analyzeHealth("src_1", "log_1", baseInput({ currentConfigHash: "abc123" }));

    const baselineWhere = mockScrapeLogFind.mock.calls[0][0]?.where;
    expect(baselineWhere).toMatchObject({
      sourceId: "src_1",
      status: "SUCCESS",
      configHash: "abc123",
    });
    expect(baselineWhere).not.toHaveProperty("OR");
  });

  it("falls back to NULL configHash only when source has no hashed history at all", async () => {
    // Primary empty + scrapeLog.findFirst probe finds no hashed row → fall back to NULL.
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // primary (hashed): empty
      .mockResolvedValueOnce(baselineEntries as never)  // fallback (null): rows
      .mockResolvedValueOnce([] as never);  // recentAll
    mockScrapeLogFindFirst.mockResolvedValueOnce(null);  // no prior hashed row

    await analyzeHealth("src_1", "log_1", baseInput({ currentConfigHash: "new-config" }));

    expect(mockScrapeLogFind.mock.calls[0][0]?.where).toMatchObject({ configHash: "new-config" });
    // Probe must exclude the current scrape's row — see "first post-deploy scrape" test below
    expect(mockScrapeLogFindFirst).toHaveBeenCalledWith({
      where: { sourceId: "src_1", id: { not: "log_1" }, configHash: { not: null } },
      select: { id: true },
    });
    expect(mockScrapeLogFind.mock.calls[1][0]?.where).toMatchObject({ configHash: null });
  });

  it("does NOT fall back to NULL when source has hashed rows from a previous regime", async () => {
    // Critical regression case: post-#1115 source with rows for OLD config.
    // Config edits to NEW config. Primary (NEW) is empty. Fallback MUST NOT
    // pull legacy NULL rows in — that would mix regimes (Codex finding).
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // primary (hashed: NEW): empty
      .mockResolvedValueOnce([] as never);  // recentAll
    mockScrapeLogFindFirst.mockResolvedValueOnce({ id: "log_old_regime" } as never);  // prior hashed row exists

    await analyzeHealth("src_1", "log_1", baseInput({ currentConfigHash: "new-config" }));

    // findFirst probe was called (current scrape excluded)
    expect(mockScrapeLogFindFirst).toHaveBeenCalledWith({
      where: { sourceId: "src_1", id: { not: "log_1" }, configHash: { not: null } },
      select: { id: true },
    });
    // Only 2 findMany calls: primary + recentAll. No NULL fallback.
    expect(mockScrapeLogFind).toHaveBeenCalledTimes(2);
    expect(mockScrapeLogFind.mock.calls[1][0]?.select).toEqual({ status: true });
  });

  it("first post-deploy scrape: NULL fallback fires even though current row already has configHash (Codex regression)", async () => {
    // The scrape orchestrator writes configHash on the current ScrapeLog
    // BEFORE analyzeHealth runs. The findFirst probe must exclude the
    // current row, otherwise it sees its own just-written hash and
    // wrongly concludes "hashed history exists" — defeating the legacy
    // NULL fallback for every source's first post-deploy scrape.
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // primary (hashed: current): empty (no prior hashed)
      .mockResolvedValueOnce(baselineEntries as never)  // fallback (null): legacy rows
      .mockResolvedValueOnce([] as never);  // recentAll
    // Probe with id-exclusion finds no PRIOR hashed row (the current row is excluded)
    mockScrapeLogFindFirst.mockResolvedValueOnce(null);

    await analyzeHealth("src_1", "log_1", baseInput({ currentConfigHash: "first-hashed" }));

    // Probe excludes the current scrape's id
    expect(mockScrapeLogFindFirst).toHaveBeenCalledWith({
      where: { sourceId: "src_1", id: { not: "log_1" }, configHash: { not: null } },
      select: { id: true },
    });
    // Fallback fired with legacy NULL rows
    expect(mockScrapeLogFind.mock.calls[1][0]?.where).toMatchObject({ configHash: null });
  });

  it("does NOT issue the NULL fallback query once hashed rows exist", async () => {
    // Primary query returns rows → fallback must not run, no findFirst probe needed.
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce(baselineEntries as never)  // primary returns 3 rows
      .mockResolvedValueOnce([] as never);  // recentAll

    await analyzeHealth("src_1", "log_1", baseInput({ currentConfigHash: "current" }));

    expect(mockScrapeLogFind).toHaveBeenCalledTimes(2);
    expect(mockScrapeLogFind.mock.calls[1][0]?.select).toEqual({ status: true });
    expect(mockScrapeLogFindFirst).not.toHaveBeenCalled();
  });

  it("filters baseline by baselineResetAt when provided", async () => {
    const reset = new Date("2026-04-15T00:00:00Z");
    await analyzeHealth("src_1", "log_1", baseInput({ baselineResetAt: reset }));

    const baselineWhere = mockScrapeLogFind.mock.calls[0][0]?.where;
    expect(baselineWhere).toMatchObject({
      startedAt: { gte: reset },
    });
  });

  it("combines configHash equality and baselineResetAt filters", async () => {
    const reset = new Date("2026-04-15T00:00:00Z");
    await analyzeHealth("src_1", "log_1", baseInput({
      currentConfigHash: "xyz789",
      baselineResetAt: reset,
    }));

    const baselineWhere = mockScrapeLogFind.mock.calls[0][0]?.where;
    expect(baselineWhere).toMatchObject({
      configHash: "xyz789",
      startedAt: { gte: reset },
    });
  });

  it("omits regime filters when neither field is provided (back-compat)", async () => {
    await analyzeHealth("src_1", "log_1", baseInput());

    const baselineWhere = mockScrapeLogFind.mock.calls[0][0]?.where;
    expect(baselineWhere).not.toHaveProperty("configHash");
    expect(baselineWhere).not.toHaveProperty("startedAt");
  });

  it("suppresses FIELD_FILL_DROP after a regime change wipes the baseline", async () => {
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // primary (hashed): no rows yet for new regime
      .mockResolvedValueOnce([] as never);  // recentAll
    // Source has hashed history from the OLD regime → fallback is gated off
    mockScrapeLogFindFirst.mockResolvedValueOnce({ id: "log_old" } as never);

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      currentConfigHash: "new-config",
      // Drastically different fill rates that would have triggered alerts
      // against the original 100/80/50/90/70 baseline:
      fillRates: { title: 50, location: 20, hares: 10, startTime: 30, runNumber: 0 },
    }));

    expect(result.alerts.find((a) => a.type === "FIELD_FILL_DROP")).toBeUndefined();
    expect(result.alerts.find((a) => a.type === "EVENT_COUNT_ANOMALY")).toBeUndefined();
    // But trend types ARE marked checked so stale prior-regime alerts auto-resolve
    expect(result.checkedTypes).toContain("FIELD_FILL_DROP");
    expect(result.checkedTypes).toContain("EVENT_COUNT_ANOMALY");
  });

  it("suppresses EXCESSIVE_CANCELLATIONS warning when baseline is empty (post-regime-reset)", async () => {
    // Codex finding: a legitimate first-scrape catch-up cleanup wave after a
    // regime reset shouldn't fire EXCESSIVE_CANCELLATIONS just on the >10
    // absolute threshold. Without baseline, we can't tell benign cleanup
    // from a real regression — so suppress the alert entirely.
    mockScrapeLogFind.mockReset();
    mockScrapeLogFind
      .mockResolvedValueOnce([] as never)  // primary: empty
      .mockResolvedValueOnce([] as never);  // recentAll
    mockScrapeLogFindFirst.mockResolvedValueOnce({ id: "log_old" } as never);  // gate fallback off

    const result = await analyzeHealth("src_1", "log_1", baseInput({
      currentConfigHash: "new-config",
      cancelledCount: 25,  // would normally fire WARNING (> 10 absolute threshold)
    }));

    expect(result.alerts.find((a) => a.type === "EXCESSIVE_CANCELLATIONS")).toBeUndefined();
    // Still registered as checked so any stale prior-regime alert auto-resolves
    expect(result.checkedTypes).toContain("EXCESSIVE_CANCELLATIONS");
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
