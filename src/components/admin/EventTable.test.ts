import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/admin/events/actions", () => ({
  deleteEvent: vi.fn(),
  deleteSelectedEvents: vi.fn(),
  bulkDeleteEvents: vi.fn(),
  previewBulkDelete: vi.fn(),
}));

import { buildFilterParams, buildSortParams, formatDate } from "./EventTable";

describe("buildFilterParams", () => {
  it("sets the key and resets page to 1", () => {
    const params = new URLSearchParams("page=3");
    const result = buildFilterParams(params, "kennelId", "abc");
    const parsed = new URLSearchParams(result);
    expect(parsed.get("kennelId")).toBe("abc");
    expect(parsed.get("page")).toBe("1");
  });

  it("removes key when value is 'all'", () => {
    const params = new URLSearchParams("kennelId=abc&page=2");
    const result = buildFilterParams(params, "kennelId", "all");
    const parsed = new URLSearchParams(result);
    expect(parsed.has("kennelId")).toBe(false);
    expect(parsed.get("page")).toBe("1");
  });

  it("removes key when value is undefined", () => {
    const params = new URLSearchParams("kennelId=abc");
    const result = buildFilterParams(params, "kennelId", undefined);
    const parsed = new URLSearchParams(result);
    expect(parsed.has("kennelId")).toBe(false);
  });

  it("preserves other params", () => {
    const params = new URLSearchParams("sourceId=xyz&page=5");
    const result = buildFilterParams(params, "kennelId", "abc");
    const parsed = new URLSearchParams(result);
    expect(parsed.get("sourceId")).toBe("xyz");
    expect(parsed.get("kennelId")).toBe("abc");
  });
});

describe("buildSortParams", () => {
  it("toggles direction when same column is clicked", () => {
    const params = new URLSearchParams();
    const result = buildSortParams(params, "date", "date", "asc");
    const parsed = new URLSearchParams(result);
    expect(parsed.get("sortDir")).toBe("desc");
  });

  it("sets new column with default direction asc", () => {
    const params = new URLSearchParams();
    const result = buildSortParams(params, "kennelName", "date", "desc");
    const parsed = new URLSearchParams(result);
    expect(parsed.get("sortBy")).toBe("kennelName");
    expect(parsed.get("sortDir")).toBe("asc");
  });

  it("defaults date column to desc direction", () => {
    const params = new URLSearchParams();
    const result = buildSortParams(params, "date", "kennelName", "asc");
    const parsed = new URLSearchParams(result);
    expect(parsed.get("sortBy")).toBe("date");
    expect(parsed.get("sortDir")).toBe("desc");
  });

  it("resets page to 1", () => {
    const params = new URLSearchParams("page=5");
    const result = buildSortParams(params, "title", "date", "desc");
    const parsed = new URLSearchParams(result);
    expect(parsed.get("page")).toBe("1");
  });
});

describe("formatDate", () => {
  it("formats an ISO date string", () => {
    const result = formatDate("2025-01-15T12:00:00.000Z");
    expect(result).toBe("Jan 15, 2025");
  });

  it("handles year boundary", () => {
    const result = formatDate("2024-12-31T12:00:00.000Z");
    expect(result).toBe("Dec 31, 2024");
  });
});
