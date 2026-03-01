import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findUnique: vi.fn(), update: vi.fn() },
    rawEvent: { deleteMany: vi.fn() },
    scrapeLog: { create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/adapters/registry", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("./merge", () => ({
  processRawEvents: vi.fn(),
}));

vi.mock("./reconcile", () => ({
  reconcileStaleEvents: vi.fn(() => Promise.resolve({ cancelled: 0, cancelledEventIds: [] })),
}));

vi.mock("./fill-rates", () => ({
  computeFillRates: vi.fn(() => ({
    title: 100, location: 80, hares: 50, startTime: 90, runNumber: 70,
  })),
}));

vi.mock("./health", () => ({
  analyzeHealth: vi.fn(() => Promise.resolve({
    healthStatus: "HEALTHY",
    alerts: [],
  })),
  persistAlerts: vi.fn(() => Promise.resolve()),
}));

import { prisma } from "@/lib/db";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents } from "./merge";
import { analyzeHealth } from "./health";
import { scrapeSource } from "./scrape";

const mockSourceFind = vi.mocked(prisma.source.findUnique);
const mockSourceUpdate = vi.mocked(prisma.source.update);
const mockRawEventDeleteMany = vi.mocked(prisma.rawEvent.deleteMany);
const mockLogCreate = vi.mocked(prisma.scrapeLog.create);
const mockLogUpdate = vi.mocked(prisma.scrapeLog.update);
const mockGetAdapter = vi.mocked(getAdapter);
const mockProcessRaw = vi.mocked(processRawEvents);
const mockAnalyzeHealth = vi.mocked(analyzeHealth);

const fakeSource = { id: "src_1", type: "HTML_SCRAPER", url: "https://test.com" };
const fakeMergeResult = {
  created: 3, updated: 1, skipped: 2, blocked: 0,
  unmatched: [], blockedTags: [],
  eventErrors: 0, eventErrorMessages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSourceFind.mockResolvedValue(fakeSource as never);
  mockLogCreate.mockResolvedValue({ id: "log_1" } as never);
  mockLogUpdate.mockResolvedValue({} as never);
  mockSourceUpdate.mockResolvedValue({} as never);
  mockGetAdapter.mockReturnValue({
    type: "HTML_SCRAPER",
    fetch: vi.fn().mockResolvedValue({ events: [{ date: "2026-02-14", kennelTag: "NYCH3" }], errors: [] }),
  } as never);
  mockProcessRaw.mockResolvedValue(fakeMergeResult);
  mockRawEventDeleteMany.mockResolvedValue({} as never);
});

describe("scrapeSource", () => {
  it("throws when source not found", async () => {
    mockSourceFind.mockResolvedValueOnce(null);
    await expect(scrapeSource("missing_id")).rejects.toThrow("Source not found");
  });

  it("creates ScrapeLog record", async () => {
    await scrapeSource("src_1");
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceId: "src_1" }),
      }),
    );
  });

  it("calls adapter.fetch with source and days", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ events: [], errors: [] });
    mockGetAdapter.mockReturnValue({ type: "HTML_SCRAPER", fetch: mockFetch } as never);

    await scrapeSource("src_1", { days: 30 });
    expect(mockFetch).toHaveBeenCalledWith(fakeSource, { days: 30 });
  });

  it("passes scrape results to processRawEvents", async () => {
    await scrapeSource("src_1");
    expect(mockProcessRaw).toHaveBeenCalledWith("src_1", expect.any(Array));
  });

  it("updates ScrapeLog on success", async () => {
    await scrapeSource("src_1");
    expect(mockLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCESS" }),
      }),
    );
  });

  it("updates ScrapeLog as FAILED when adapter errors exist", async () => {
    mockGetAdapter.mockReturnValue({
      type: "HTML_SCRAPER",
      fetch: vi.fn().mockResolvedValue({ events: [], errors: ["fetch error"] }),
    } as never);

    await scrapeSource("src_1");
    expect(mockLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("deletes old RawEvents in force mode", async () => {
    await scrapeSource("src_1", { force: true });
    expect(mockRawEventDeleteMany).toHaveBeenCalledWith({
      where: { sourceId: "src_1" },
    });
  });

  it("does not delete RawEvents in normal mode", async () => {
    await scrapeSource("src_1");
    expect(mockRawEventDeleteMany).not.toHaveBeenCalled();
  });

  it("sets source to FAILING on thrown error", async () => {
    mockGetAdapter.mockReturnValue({
      type: "HTML_SCRAPER",
      fetch: vi.fn().mockRejectedValue(new Error("Network error")),
    } as never);
    mockAnalyzeHealth.mockResolvedValueOnce({
      healthStatus: "FAILING",
      alerts: [],
    });

    const result = await scrapeSource("src_1");
    expect(result.success).toBe(false);
    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthStatus: "FAILING" }),
      }),
    );
  });

  it("returns structured ScrapeSourceResult", async () => {
    const result = await scrapeSource("src_1");
    expect(result).toMatchObject({
      success: true,
      scrapeLogId: "log_1",
      forced: false,
      eventsFound: 1,
      created: 3,
      updated: 1,
      skipped: 2,
      blocked: 0,
    });
  });

  it("does not store empty sample arrays in ScrapeLog", async () => {
    // Default fakeMergeResult has no sampleBlocked/sampleSkipped fields
    mockProcessRaw.mockResolvedValueOnce({
      ...fakeMergeResult,
      sampleBlocked: [],
      sampleSkipped: [],
    });

    await scrapeSource("src_1");
    const updateData = mockLogUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    // Empty arrays should be stored as undefined (which Prisma treats as "don't set")
    expect(updateData.data.sampleBlocked).toBeUndefined();
    expect(updateData.data.sampleSkipped).toBeUndefined();
  });

  it("does not reject GOOGLE_CALENDAR sources with calendar-ID URLs", async () => {
    const gcalSource = { id: "src_gcal", type: "GOOGLE_CALENDAR", url: "bostonhash@gmail.com" };
    mockSourceFind.mockResolvedValueOnce(gcalSource as never);
    mockGetAdapter.mockReturnValue({
      type: "GOOGLE_CALENDAR",
      fetch: vi.fn().mockResolvedValue({ events: [{ date: "2026-03-01", kennelTag: "BH3" }], errors: [] }),
    } as never);

    const result = await scrapeSource("src_gcal");
    expect(result.success).toBe(true);
  });

  it("stores non-empty sample arrays in ScrapeLog", async () => {
    const sampleBlocked = [{ reason: "SOURCE_KENNEL_MISMATCH", kennelTag: "OtherH3", event: {}, suggestedAction: "Link" }];
    const sampleSkipped = [{ reason: "UNMATCHED_TAG", kennelTag: "UnknownH3", event: {}, suggestedAction: "Create" }];
    mockProcessRaw.mockResolvedValueOnce({
      ...fakeMergeResult,
      sampleBlocked,
      sampleSkipped,
    });

    await scrapeSource("src_1");
    const updateData = mockLogUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateData.data.sampleBlocked).toEqual(sampleBlocked);
    expect(updateData.data.sampleSkipped).toEqual(sampleSkipped);
  });
});
