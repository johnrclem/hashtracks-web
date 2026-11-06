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
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    attendance: {
      findMany: vi.fn(),
    },
    stravaDismissal: {
      findMany: vi.fn(),
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
import { syncStravaActivities, purgeExpiredStravaCache } from "./sync";
import { STRAVA_CACHE_TTL_HOURS, STALE_HOURS } from "./constants";
import { stravaActivityKey } from "./activity-key";

const mockConnectionFindUnique = vi.mocked(prisma.stravaConnection.findUnique);
const mockConnectionUpdate = vi.mocked(prisma.stravaConnection.update);
const mockActivityFindMany = vi.mocked(prisma.stravaActivity.findMany);
const mockActivityCreateMany = vi.mocked(prisma.stravaActivity.createMany);
const mockActivityUpdateMany = vi.mocked(prisma.stravaActivity.updateMany);
const mockActivityDeleteMany = vi.mocked(prisma.stravaActivity.deleteMany);
const mockAttendanceFindMany = vi.mocked(prisma.attendance.findMany);
const mockDismissalFindMany = vi.mocked(prisma.stravaDismissal.findMany);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockedGetToken = vi.mocked(getValidAccessToken);
const mockedFetchActivities = vi.mocked(fetchStravaActivities);
const mockedParseActivity = vi.mocked(parseStravaActivity);

beforeEach(() => {
  vi.clearAllMocks();
  // Durable match state defaults: nothing linked, nothing dismissed
  mockAttendanceFindMany.mockResolvedValue([] as never);
  mockDismissalFindMany.mockResolvedValue([] as never);
  mockActivityDeleteMany.mockResolvedValue({ count: 0 } as never);
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
    mockConnectionFindUnique.mockResolvedValue(null as never);

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
    mockConnectionFindUnique.mockResolvedValue(connection as never);

    const result = await syncStravaActivities("user_1");

    expect(result.skipped).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockedGetToken).not.toHaveBeenCalled();
  });

  it("syncs when forceRefresh is true even if recently synced", async () => {
    const connection = buildStravaConnection({
      lastSyncAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
    });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([] as never);

    const result = await syncStravaActivities("user_1", {
      forceRefresh: true,
    });

    expect(mockedGetToken).toHaveBeenCalled();
    expect(result.total).toBe(0);
  });

  it("batch creates new activities via createMany", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    mockedFetchActivities.mockResolvedValue([{ id: 111, name: "Run" }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("111", "Run"));

    // No existing activities
    mockActivityFindMany.mockResolvedValue([] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.total).toBe(1);
    expect(mockActivityCreateMany).toHaveBeenCalledOnce();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("batch updates existing activities via $transaction", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    mockedFetchActivities.mockResolvedValue([{ id: 222, name: "Updated" }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("222", "Updated"));

    // Activity already exists
    mockActivityFindMany.mockResolvedValue([
      { stravaActivityId: "222" },
    ] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(1);
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockActivityCreateMany).not.toHaveBeenCalled();
  });

  it("updates lastSyncAt after successful sync", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([] as never);

    await syncStravaActivities("user_1");

    expect(mockConnectionUpdate).toHaveBeenCalledWith({
      where: { id: connection.id },
      data: { lastSyncAt: expect.any(Date) },
    });
  });

  it("returns error when token refresh fails", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockRejectedValue(new Error("Token expired"));

    const result = await syncStravaActivities("user_1");

    expect(result.error).toBe("Token expired");
    expect(result.total).toBe(0);
  });

  it("returns error when activity fetch fails", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockRejectedValue(new Error("Rate limited"));

    const result = await syncStravaActivities("user_1");

    expect(result.error).toBe("Rate limited");
    expect(result.total).toBe(0);
  });

  it("handles mix of new and existing activities", async () => {
    const connection = buildStravaConnection({ lastSyncAt: null });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);

    mockedFetchActivities.mockResolvedValue([
      { id: 1, name: "New" },
      { id: 2, name: "Existing" },
    ] as never);

    mockedParseActivity
      .mockReturnValueOnce(makeParsed("1", "New"))
      .mockReturnValueOnce(makeParsed("2", "Existing"));

    // Only activity "2" exists
    mockActivityFindMany.mockResolvedValue([
      { stravaActivityId: "2" },
    ] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(2);
    expect(mockActivityCreateMany).toHaveBeenCalledOnce();
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
  it("syncs when the last sync is older than STALE_HOURS", async () => {
    const connection = buildStravaConnection({
      lastSyncAt: new Date(Date.now() - (STALE_HOURS + 1) * 60 * 60 * 1000),
    });
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([] as never);

    const result = await syncStravaActivities("user_1");

    expect(result.skipped).toBeUndefined();
    expect(mockedGetToken).toHaveBeenCalled();
  });

  it("stamps fetchedAt and guards concurrent inserts with skipDuplicates", async () => {
    mockConnectionFindUnique.mockResolvedValue(buildStravaConnection() as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([{ id: 111 }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("111", "Run"));
    mockActivityFindMany.mockResolvedValue([] as never);

    await syncStravaActivities("user_1");

    const arg = mockActivityCreateMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0].fetchedAt).toBeInstanceOf(Date);
  });

  it("rehydrates links and dismissals onto newly cached activities", async () => {
    mockConnectionFindUnique.mockResolvedValue(buildStravaConnection() as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as never);
    mockedParseActivity
      .mockReturnValueOnce(makeParsed("1", "Linked run"))
      .mockReturnValueOnce(makeParsed("2", "Dismissed walk"))
      .mockReturnValueOnce(makeParsed("3", "Fresh run"));
    mockActivityFindMany.mockResolvedValue([] as never);
    mockAttendanceFindMany.mockResolvedValue([
      { id: "att_1", stravaUrl: "https://www.strava.com/activities/1" },
      { id: "att_manual", stravaUrl: "https://example.com/not-strava" },
    ] as never);
    mockDismissalFindMany.mockResolvedValue([
      { activityKey: stravaActivityKey("2") },
    ] as never);

    await syncStravaActivities("user_1");

    expect(mockAttendanceFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1", stravaUrl: { not: null } },
      select: { id: true, stravaUrl: true },
    });
    const rows = (mockActivityCreateMany.mock.calls[0][0] as {
      data: Array<{ stravaActivityId: string; matchedAttendanceId: string | null; matchDismissed: boolean }>;
    }).data;
    const byId = Object.fromEntries(rows.map((r) => [r.stravaActivityId, r]));
    expect(byId["1"]).toMatchObject({ matchedAttendanceId: "att_1", matchDismissed: false });
    expect(byId["2"]).toMatchObject({ matchedAttendanceId: null, matchDismissed: true });
    expect(byId["3"]).toMatchObject({ matchedAttendanceId: null, matchDismissed: false });
  });

  it("rehydrates match state and fetchedAt on existing cached activities", async () => {
    mockConnectionFindUnique.mockResolvedValue(buildStravaConnection() as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([{ id: 2 }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("2", "Dismissed walk"));
    mockActivityFindMany.mockResolvedValue([{ stravaActivityId: "2" }] as never);
    mockDismissalFindMany.mockResolvedValue([
      { activityKey: stravaActivityKey("2") },
    ] as never);

    await syncStravaActivities("user_1");

    expect(mockActivityUpdateMany).toHaveBeenCalledWith({
      where: { stravaActivityId: "2" },
      data: expect.objectContaining({
        fetchedAt: expect.any(Date),
        matchDismissed: true,
      }),
    });
  });

  it("never clears link/dismiss state on existing rows (a concurrent attach must survive)", async () => {
    mockConnectionFindUnique.mockResolvedValue(buildStravaConnection() as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([{ id: 3 }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("3", "Run"));
    mockActivityFindMany.mockResolvedValue([{ stravaActivityId: "3" }] as never);
    // Snapshot: nothing linked or dismissed (an attach may land mid-sync)

    await syncStravaActivities("user_1");

    const { data } = mockActivityUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty("matchedAttendanceId");
    expect(data).not.toHaveProperty("matchDismissed");
    expect(data.fetchedAt).toBeInstanceOf(Date);
  });

  it("removes cached activities Strava no longer returns", async () => {
    const connection = buildStravaConnection();
    mockConnectionFindUnique.mockResolvedValue(connection as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockResolvedValue([{ id: 5 }] as never);
    mockedParseActivity.mockReturnValue(makeParsed("5", "Still there"));
    mockActivityFindMany.mockResolvedValue([] as never);

    await syncStravaActivities("user_1");

    expect(mockActivityDeleteMany).toHaveBeenCalledWith({
      where: {
        stravaConnectionId: connection.id,
        stravaActivityId: { notIn: ["5"] },
      },
    });
  });

  it("does not touch the cache when the activity fetch fails", async () => {
    mockConnectionFindUnique.mockResolvedValue(buildStravaConnection() as never);
    mockedGetToken.mockResolvedValue({ accessToken: "token123" } as never);
    mockedFetchActivities.mockRejectedValue(new Error("Strava activity fetch failed (401)"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncStravaActivities("user_1");

    expect(result.error).toContain("401");
    expect(mockActivityDeleteMany).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[strava-sync]"));
    consoleSpy.mockRestore();
  });
});

describe("purgeExpiredStravaCache", () => {
  it("deletes only cache rows fetched before the TTL cutoff", async () => {
    mockActivityDeleteMany.mockResolvedValue({ count: 7 } as never);
    const now = new Date("2026-11-06T12:00:00Z");

    const result = await purgeExpiredStravaCache(now);

    const cutoff = new Date(now.getTime() - STRAVA_CACHE_TTL_HOURS * 60 * 60 * 1000);
    expect(mockActivityDeleteMany).toHaveBeenCalledWith({
      where: { fetchedAt: { lt: cutoff } },
    });
    expect(result).toEqual({ deleted: 7, olderThan: cutoff });
  });

  it("keeps the TTL comfortably above the resync interval and under Strava's 48h deletion window", () => {
    expect(STRAVA_CACHE_TTL_HOURS).toBeGreaterThan(STALE_HOURS * 2);
    // Daily cron: worst-case row age is TTL + 24h
    expect(STRAVA_CACHE_TTL_HOURS + 24).toBeLessThanOrEqual(48);
  });
});
