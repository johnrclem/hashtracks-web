import { describe, it, expect, vi, beforeEach } from "vitest";
import { previewSourceConfig } from "./preview-action";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getAdminUser: vi.fn(),
}));

vi.mock("@/adapters/registry", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("@/pipeline/kennel-resolver", () => ({
  resolveKennelTag: vi.fn(),
  clearResolverCache: vi.fn(),
}));

// config-validation is a pure module — no mock needed (uses real validation)

import { getAdminUser } from "@/lib/auth";
import { getAdapter } from "@/adapters/registry";
import { resolveKennelTag, clearResolverCache } from "@/pipeline/kennel-resolver";

const mockedGetAdminUser = vi.mocked(getAdminUser);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedResolveKennelTag = vi.mocked(resolveKennelTag);

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

describe("previewSourceConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedGetAdminUser.mockResolvedValue({ id: "admin-1" } as never);
  });

  it("rejects non-admin users", async () => {
    mockedGetAdminUser.mockResolvedValue(null as never);
    const result = await previewSourceConfig(
      makeFormData({ type: "HTML_SCRAPER", url: "https://example.com" }),
    );
    expect(result.error).toBe("Not authorized");
  });

  it("requires type and url", async () => {
    const result = await previewSourceConfig(makeFormData({ type: "" }));
    expect(result.error).toBe("Type and URL are required for preview");
  });

  it("rejects invalid JSON config", async () => {
    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
        config: "not json",
      }),
    );
    expect(result.error).toBe("Invalid JSON in config field");
  });

  it("runs config validation before fetching", async () => {
    const result = await previewSourceConfig(
      makeFormData({
        type: "GOOGLE_SHEETS",
        url: "https://sheets.google.com",
        config: "{}",
      }),
    );
    expect(result.error).toContain("Config validation failed");
    expect(result.error).toContain("sheetId");
    // Should not have called the adapter
    expect(mockedGetAdapter).not.toHaveBeenCalled();
  });

  it("returns error when adapter is not found", async () => {
    mockedGetAdapter.mockImplementation(() => {
      throw new Error("Unknown source type");
    });

    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://unknown-site.com",
      }),
    );
    expect(result.error).toContain("No adapter found");
    expect(result.error).toContain("Unknown source type");
  });

  it("returns error when adapter fetch fails", async () => {
    const mockAdapter = {
      fetch: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);

    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );
    expect(result.error).toContain("Adapter fetch failed");
    expect(result.error).toContain("Network timeout");
  });

  it("returns preview data on successful fetch", async () => {
    const mockEvents = [
      {
        date: "2026-03-01",
        kennelTag: "NYCH3",
        title: "Run #2000",
        location: "Central Park",
        hares: "John",
        startTime: "14:00",
        runNumber: 2000,
      },
      {
        date: "2026-03-08",
        kennelTag: "EWH3",
        title: "Trail Run",
        location: null,
        hares: null,
        startTime: "11:00",
        runNumber: null,
      },
    ];
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({
        events: mockEvents,
        errors: [],
      }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);
    mockedResolveKennelTag.mockImplementation(async (tag: string) => {
      if (tag === "NYCH3") return { kennelId: "k1", matched: true };
      return { kennelId: null, matched: false };
    });

    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data!.totalCount).toBe(2);
    expect(result.data!.events).toHaveLength(2);
    expect(result.data!.events[0].resolved).toBe(true);
    expect(result.data!.events[1].resolved).toBe(false);
    expect(result.data!.unmatchedTags).toEqual(["EWH3"]);
    expect(result.data!.fillRates.title).toBe(100);
    expect(result.data!.fillRates.location).toBe(50);
    expect(result.data!.fillRates.hares).toBe(50);
  });

  it("caps preview events at 25", async () => {
    const mockEvents = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, "0")}`,
      kennelTag: "NYCH3",
      title: `Run #${i}`,
    }));
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({
        events: mockEvents,
        errors: [],
      }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);
    mockedResolveKennelTag.mockResolvedValue({
      kennelId: "k1",
      matched: true,
    } as never);

    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );

    expect(result.data!.events).toHaveLength(25);
    expect(result.data!.totalCount).toBe(40);
  });

  it("passes adapter errors through to preview data", async () => {
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({
        events: [],
        errors: ["Failed to parse row 5", "Invalid date in row 12"],
      }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);

    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );

    expect(result.data!.errors).toEqual([
      "Failed to parse row 5",
      "Invalid date in row 12",
    ]);
    expect(result.data!.totalCount).toBe(0);
  });

  it("passes config to mock source for adapter", async () => {
    const config = { defaultKennelTag: "EWH3", skipPatterns: ["^Cancelled"] };
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({ events: [], errors: [] }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);

    await previewSourceConfig(
      makeFormData({
        type: "ICAL_FEED",
        url: "https://example.com/feed.ics",
        config: JSON.stringify(config),
      }),
    );

    // Verify the mock source passed to adapter has the config
    const callArgs = mockAdapter.fetch.mock.calls[0];
    expect(callArgs[0].config).toEqual(config);
    expect(callArgs[0].type).toBe("ICAL_FEED");
    expect(callArgs[0].url).toBe("https://example.com/feed.ics");
    expect(callArgs[1]).toEqual({ days: 30 });
  });

  it("clears resolver cache before resolving tags", async () => {
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({
        events: [{ date: "2026-03-01", kennelTag: "TestH3" }],
        errors: [],
      }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);
    mockedResolveKennelTag.mockResolvedValue({
      kennelId: null,
      matched: false,
    } as never);

    await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );

    expect(clearResolverCache).toHaveBeenCalled();
  });

  it("handles null config gracefully for types that don't require it", async () => {
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({ events: [], errors: [] }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);

    const result = await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    // Config should be null in the mock source
    const callArgs = mockAdapter.fetch.mock.calls[0];
    expect(callArgs[0].config).toBeNull();
  });

  it("deduplicates kennel tags before resolving", async () => {
    const mockEvents = [
      { date: "2026-03-01", kennelTag: "NYCH3" },
      { date: "2026-03-08", kennelTag: "NYCH3" },
      { date: "2026-03-15", kennelTag: "NYCH3" },
    ];
    const mockAdapter = {
      fetch: vi.fn().mockResolvedValue({ events: mockEvents, errors: [] }),
    };
    mockedGetAdapter.mockReturnValue(mockAdapter as never);
    mockedResolveKennelTag.mockResolvedValue({
      kennelId: "k1",
      matched: true,
    } as never);

    await previewSourceConfig(
      makeFormData({
        type: "HTML_SCRAPER",
        url: "https://example.com",
      }),
    );

    // resolveKennelTag should only be called once for the deduplicated tag
    expect(mockedResolveKennelTag).toHaveBeenCalledTimes(1);
    expect(mockedResolveKennelTag).toHaveBeenCalledWith("NYCH3");
  });
});
