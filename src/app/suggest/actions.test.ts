import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUser = { id: "user_1" };

vi.mock("@/lib/auth", () => ({ getOrCreateUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    kennelRequest: { create: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    region: { findFirst: vi.fn() },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));
vi.mock("@/lib/region", () => ({
  REGION_SEED_DATA: [
    {
      name: "New York City",
      country: "USA",
      timezone: "America/New_York",
      abbrev: "NYC",
      colorClasses: "bg-blue-200 text-blue-800",
      pinColor: "#2563eb",
      centroidLat: 40.7128,
      centroidLng: -74.006,
      aliases: ["NYC", "New York"],
    },
    {
      name: "London",
      country: "UK",
      timezone: "Europe/London",
      abbrev: "LDN",
      colorClasses: "bg-red-200 text-red-800",
      pinColor: "#dc2626",
      centroidLat: 51.5074,
      centroidLng: -0.1278,
      aliases: ["London, England", "London, UK"],
    },
  ],
}));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { submitKennelSuggestion } from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockCreate = vi.mocked(prisma.kennelRequest.create);
const mockCount = vi.mocked(prisma.kennelRequest.count);
const mockRequestFind = vi.mocked(prisma.kennelRequest.findFirst);
const mockRegionFind = vi.mocked(prisma.region.findFirst);
const mockHeaders = vi.mocked(headers);

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const validFields = {
  kennelName: "Test Hash House Harriers",
  region: "New York City",
  relationship: "HASH_WITH",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
  mockCreate.mockResolvedValue({} as never);
  mockCount.mockResolvedValue(0 as never);
  mockRequestFind.mockResolvedValue(null as never);
  mockRegionFind.mockResolvedValue(null as never);
  mockHeaders.mockResolvedValue(
    new Map([["x-forwarded-for", "1.2.3.4"]]) as never,
  );
});

describe("submitKennelSuggestion", () => {
  it("creates a KennelRequest with source PUBLIC", async () => {
    mockRegionFind.mockResolvedValueOnce({ id: "region_nyc" } as never);

    const fd = makeFormData({
      ...validFields,
      sourceUrl: "https://testhash.com",
      email: "test@example.com",
      notes: "Great kennel, runs every Saturday",
    });

    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kennelName: "Test Hash House Harriers",
        region: "New York City",
        relationship: "HASH_WITH",
        sourceUrl: "https://testhash.com",
        email: "test@example.com",
        notes: "Great kennel, runs every Saturday",
        source: "PUBLIC",
        userId: "user_1",
        regionId: "region_nyc",
        ipHash: expect.any(String),
      }),
    });
  });

  it("returns error when kennelName is missing", async () => {
    const fd = makeFormData({ region: "NYC", relationship: "HASH_WITH" });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ error: "Kennel name is required" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns error when region is missing", async () => {
    const fd = makeFormData({
      kennelName: "Test Hash",
      relationship: "HASH_WITH",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ error: "Region is required" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns silent success when honeypot is filled (bot trap)", async () => {
    const fd = makeFormData({
      ...validFields,
      website_url_confirm: "http://spam.com",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ success: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns error when anonymous rate limit exceeded", async () => {
    mockAuth.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(5 as never);

    const fd = makeFormData(validFields);
    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({
      error:
        "Too many suggestions from this location. Please try again later.",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns error when authenticated rate limit exceeded", async () => {
    mockCount.mockResolvedValueOnce(10 as never);

    const fd = makeFormData(validFields);
    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({
      error:
        "You've submitted too many suggestions recently. Please try again later.",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("auto-links regionId for known region name", async () => {
    mockRegionFind.mockResolvedValueOnce({ id: "region_nyc" } as never);

    const fd = makeFormData(validFields);
    await submitKennelSuggestion(null, fd);

    expect(mockRegionFind).toHaveBeenCalledWith({
      where: { name: { equals: "New York City", mode: "insensitive" } },
      select: { id: true },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ regionId: "region_nyc" }),
    });
  });

  it("auto-links regionId via alias fallback", async () => {
    // First call (direct name lookup) returns null
    mockRegionFind.mockResolvedValueOnce(null as never);
    // Second call (canonical name from alias) returns the region
    mockRegionFind.mockResolvedValueOnce({ id: "region_ldn" } as never);

    const fd = makeFormData({
      ...validFields,
      region: "London, England",
    });
    await submitKennelSuggestion(null, fd);

    // Second findFirst should be for canonical name "London"
    expect(mockRegionFind).toHaveBeenCalledTimes(2);
    expect(mockRegionFind).toHaveBeenNthCalledWith(2, {
      where: { name: { equals: "London", mode: "insensitive" } },
      select: { id: true },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ regionId: "region_ldn" }),
    });
  });

  it("leaves regionId null for unknown region", async () => {
    mockRegionFind.mockResolvedValue(null as never);

    const fd = makeFormData({
      ...validFields,
      region: "Unknown City",
    });
    await submitKennelSuggestion(null, fd);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ regionId: null }),
    });
  });

  it("returns error for invalid relationship value", async () => {
    const fd = makeFormData({
      ...validFields,
      relationship: "INVALID",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({
      error: "Please select how you know this kennel",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("works for anonymous users (auth returns null)", async () => {
    mockAuth.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0 as never);

    const fd = makeFormData(validFields);
    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, source: "PUBLIC" }),
    });
  });

  it("works when auth throws (e.g., no Clerk context)", async () => {
    mockAuth.mockRejectedValueOnce(new Error("No auth context"));
    mockCount.mockResolvedValueOnce(0 as never);

    const fd = makeFormData(validFields);
    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null }),
    });
  });

  it("rejects javascript: URLs in sourceUrl", async () => {
    const fd = makeFormData({
      ...validFields,
      sourceUrl: "javascript:alert(1)",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ error: "Invalid URL — must start with http:// or https://" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects data: URLs in sourceUrl", async () => {
    const fd = makeFormData({
      ...validFields,
      sourceUrl: "data:text/html,<h1>bad</h1>",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ error: "Invalid URL — must start with http:// or https://" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs in sourceUrl", async () => {
    const fd = makeFormData({
      ...validFields,
      sourceUrl: "not a url",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ error: "Invalid URL format" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts valid http/https URLs in sourceUrl", async () => {
    const fd = makeFormData({
      ...validFields,
      sourceUrl: "https://example.com/hash",
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalled();
  });

  it("returns error when notes exceed 1000 characters", async () => {
    const fd = makeFormData({
      ...validFields,
      notes: "x".repeat(1001),
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ error: "Notes too long (max 1000 characters)" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts notes at exactly 1000 characters", async () => {
    const fd = makeFormData({
      ...validFields,
      notes: "x".repeat(1000),
    });
    const result = await submitKennelSuggestion(null, fd);
    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalled();
  });

  it("returns silent success for duplicate kennel+region within 24h", async () => {
    mockRequestFind.mockResolvedValueOnce({ id: "existing_req" } as never);

    const fd = makeFormData(validFields);
    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({ success: true });
    expect(mockRequestFind).toHaveBeenCalledWith({
      where: {
        kennelName: { equals: "Test Hash House Harriers", mode: "insensitive" },
        region: { equals: "New York City", mode: "insensitive" },
        createdAt: { gte: expect.any(Date) },
        source: "PUBLIC",
      },
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates request when no duplicate exists", async () => {
    mockRequestFind.mockResolvedValueOnce(null as never);

    const fd = makeFormData(validFields);
    const result = await submitKennelSuggestion(null, fd);

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalled();
  });

  it("salts the IP hash (ipHash is a non-empty hex string)", async () => {
    const fd = makeFormData(validFields);
    await submitKennelSuggestion(null, fd);

    const createCall = mockCreate.mock.calls[0]?.[0] as { data: { ipHash: string } } | undefined;
    expect(createCall?.data.ipHash).toBeTruthy();
    expect(createCall?.data.ipHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
