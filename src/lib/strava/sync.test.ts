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
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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

    const result = await syncStravaActivities("user_1", {
      forceRefresh: true,
    });

    expect(mockedGetToken).toHaveBeenCalled();
    expect(result.total).toBe(0);
  });

  it("creates new activities that don't exist yet", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    const rawActivity = { id: 111, name: "Run" };
    mockedFetchActivities.mockResolvedValue([rawActivity] as never);
    mockedParseActivity.mockReturnValue({
      stravaActivityId: "111",
      name: "Run",
      sportType: "Run",
      dateLocal: "2026-02-14",
      timeLocal: "07:30",
      distanceMeters: 5000,
      movingTimeSecs: 1800,
      startLat: null,
      startLng: null,
      timezone: null,
    });

    // Activity doesn't exist
    mockedPrisma.stravaActivity.findUnique.mockResolvedValue(null as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.total).toBe(1);
    expect(mockedPrisma.stravaActivity.create).toHaveBeenCalledOnce();
  });

  it("updates existing activities", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    const rawActivity = { id: 222, name: "Updated Run" };
    mockedFetchActivities.mockResolvedValue([rawActivity] as never);
    mockedParseActivity.mockReturnValue({
      stravaActivityId: "222",
      name: "Updated Run",
      sportType: "Run",
      dateLocal: "2026-02-14",
      timeLocal: "08:00",
      distanceMeters: 6000,
      movingTimeSecs: 2100,
      startLat: null,
      startLng: null,
      timezone: null,
    });

    // Activity already exists
    mockedPrisma.stravaActivity.findUnique.mockResolvedValue({ id: "sa_existing" } as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(1);
    expect(mockedPrisma.stravaActivity.update).toHaveBeenCalled();
  });

  it("updates lastSyncAt after successful sync", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockedPrisma.stravaConnection.findUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([]);

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
      .mockReturnValueOnce({
        stravaActivityId: "1",
        name: "New",
        sportType: "Run",
        dateLocal: "2026-02-14",
        timeLocal: null,
        distanceMeters: 5000,
        movingTimeSecs: 1800,
        startLat: null,
        startLng: null,
        timezone: null,
      })
      .mockReturnValueOnce({
        stravaActivityId: "2",
        name: "Existing",
        sportType: "Run",
        dateLocal: "2026-02-15",
        timeLocal: null,
        distanceMeters: 3000,
        movingTimeSecs: 1200,
        startLat: null,
        startLng: null,
        timezone: null,
      });

    // First not found, second found
    mockedPrisma.stravaActivity.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "existing" } as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(2);
  });
});
