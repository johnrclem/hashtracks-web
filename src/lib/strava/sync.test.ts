import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStravaConnection } from "@/test/factories";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    stravaConnection: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    stravaActivity: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("./client", () => ({
  getValidAccessToken: vi.fn(),
  fetchStravaActivities: vi.fn(),
  parseStravaActivity: vi.fn(),
}));

import { prisma } from "@/lib/db";
import {
  getValidAccessToken,
  fetchStravaActivities,
  parseStravaActivity,
} from "./client";
import { syncStravaActivities } from "./sync";

const mockedPrisma = vi.mocked(prisma);
const mockedGetToken = vi.mocked(getValidAccessToken);
const mockedFetchActivities = vi.mocked(fetchStravaActivities);
const mockedParseActivity = vi.mocked(parseStravaActivity);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeParsed(id: string, name: string) {
  return {
    stravaActivityId: id,
    name,
    sportType: "Run",
    dateLocal: "2026-02-14",
    timeLocal: null,
    distanceMeters: 5000,
    movingTimeSecs: 1800,
    startLat: null,
    startLng: null,
    timezone: null,
  };
}

describe("syncStravaActivities", () => {
  it("returns error when no connection exists", async () => {
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(null as never);

    const result = await syncStravaActivities("user_1");

    expect(result).toEqual({
      created: 0,
      updated: 0,
      total: 0,
      error: "No Strava connection",
    });
  });

  it("skips sync if recently synced (within 6 hours)", async () => {
    const connection = buildStravaConnection({
      lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);

    const result = await syncStravaActivities("user_1");

    expect(result.error).toBe("Sync skipped (recent)");
    expect(mockedGetToken).not.toHaveBeenCalled();
  });

  it("syncs when forceRefresh is true even if recently synced", async () => {
    const connection = buildStravaConnection({
      lastSyncAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
    });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([]);
    mockedPrisma.stravaActivity.findMany.mockResolvedValue([] as never);

    const result = await syncStravaActivities("user_1", {
      forceRefresh: true,
    });

    expect(mockedGetToken).toHaveBeenCalled();
    expect(result.total).toBe(0);
  });

  it("batch creates new activities via createMany", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    mockedFetchActivities.mockResolvedValue([{ id: 111, name: "Run" }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("111", "Run"));

    // No existing activities
    mockedPrisma.stravaActivity.findMany.mockResolvedValue([] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.total).toBe(1);
    expect(mockedPrisma.stravaActivity.createMany).toHaveBeenCalledOnce();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("batch updates existing activities via $transaction", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    mockedFetchActivities.mockResolvedValue([{ id: 222, name: "Updated" }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("222", "Updated"));

    // Activity already exists
    mockedPrisma.stravaActivity.findMany.mockResolvedValue([
      { stravaActivityId: "222" },
    ] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockedPrisma.stravaActivity.createMany).not.toHaveBeenCalled();
  });

  it("updates lastSyncAt after successful sync", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([]);
    mockedPrisma.stravaActivity.findMany.mockResolvedValue([] as never);

    await syncStravaActivities("user_1");

    expect(mockedPrisma.stravaConnection.update).toHaveBeenCalledWith({
      where: { id: connection.id },
      data: { lastSyncAt: expect.any(Date) },
    });
  });

  it("returns error when token refresh fails", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockRejectedValue(new Error("Token expired"));

    const result = await syncStravaActivities("user_1");

    expect(result.error).toBe("Token expired");
    expect(result.total).toBe(0);
  });

  it("returns error when activity fetch fails", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockRejectedValue(new Error("Rate limited"));

    const result = await syncStravaActivities("user_1");

    expect(result.error).toBe("Rate limited");
    expect(result.total).toBe(0);
  });

  it("handles mix of new and existing activities", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    mockedFetchActivities.mockResolvedValue([
      { id: 1, name: "New" },
      { id: 2, name: "Existing" },
    ] as never);

    mockedParseActivity
      .mockReturnValueOnce(makeParsed("1", "New"))
      .mockReturnValueOnce(makeParsed("2", "Existing"));

    // Only activity "2" exists
    mockedPrisma.stravaActivity.findMany.mockResolvedValue([
      { stravaActivityId: "2" },
    ] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(2);
    expect(mockedPrisma.stravaActivity.createMany).toHaveBeenCalledOnce();
    expect(mockedPrisma.$transaction).toHaveBeenCalledOnce();
  });
});
