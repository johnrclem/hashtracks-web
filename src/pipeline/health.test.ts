import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    scrapeLog: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { analyzeHealth } from "./health";

const mockScrapeLogFind = vi.mocked(prisma.scrapeLog.findMany);

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
    expect((alert!.context!.tags as string[])).toContain("NewKennel");
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
