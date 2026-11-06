import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

const mockUser = { id: "user_1", clerkId: "clerk_1", email: "test@test.com" };

vi.mock("@/lib/auth", () => ({
  getOrCreateUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    attendance: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    stravaConnection: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    stravaActivity: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    stravaDismissal: {
      upsert: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/strava/sync", () => ({
  syncStravaActivities: vi.fn(),
}));

vi.mock("@/lib/strava/client", () => ({
  deauthorizeStrava: vi.fn(),
  getValidAccessToken: vi.fn(),
}));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncStravaActivities } from "@/lib/strava/sync";
import { getValidAccessToken, deauthorizeStrava } from "@/lib/strava/client";
import { stravaActivityKey } from "@/lib/strava/activity-key";
import {
  syncStravaIfStale,
  dismissStravaMatch,
  dismissAllStravaMatches,
  undismissStravaMatch,
  disconnectStrava,
  attachStravaActivity,
  getStravaActivitiesForDate,
} from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockSync = vi.mocked(syncStravaActivities);
const mockTransaction = vi.mocked(prisma.$transaction);

const ownedActivity = {
  id: "sa_1",
  stravaActivityId: "9876543210",
  stravaConnectionId: "sc_1",
  connection: { userId: "user_1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
  mockTransaction.mockResolvedValue([{ count: 0 }] as never);
});

describe("syncStravaIfStale", () => {
  it("runs a non-forced sync so a fresh cache is left alone", async () => {
    mockSync.mockResolvedValueOnce({ created: 0, updated: 0, removed: 0, total: 0, skipped: true });

    const result = await syncStravaIfStale();

    expect(mockSync).toHaveBeenCalledWith("user_1");
    expect(result).toEqual({ success: true, synced: false });
  });

  it("reports a completed sync with its timestamp", async () => {
    mockSync.mockResolvedValueOnce({ created: 2, updated: 1, removed: 0, total: 3 });

    const result = await syncStravaIfStale();

    expect(result).toMatchObject({ success: true, synced: true, lastSyncAt: expect.any(String) });
  });

  it("surfaces sync errors instead of failing silently", async () => {
    mockSync.mockResolvedValueOnce({
      created: 0, updated: 0, removed: 0, total: 0,
      error: "Strava token refresh failed (401): Authorization Error",
    });

    const result = await syncStravaIfStale();

    expect(result).toEqual({ error: "Strava token refresh failed (401): Authorization Error" });
  });

  it("requires authentication", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await syncStravaIfStale()).toEqual({ error: "Not authenticated" });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("dismissStravaMatch", () => {
  it("flags the cached row and records a durable hashed dismissal", async () => {
    vi.mocked(prisma.stravaActivity.findUnique).mockResolvedValueOnce(ownedActivity as never);

    const result = await dismissStravaMatch("sa_1");

    expect(result).toEqual({ success: true });
    expect(prisma.stravaActivity.update).toHaveBeenCalledWith({
      where: { id: "sa_1" },
      data: { matchDismissed: true },
    });
    const key = stravaActivityKey("9876543210");
    expect(prisma.stravaDismissal.upsert).toHaveBeenCalledWith({
      where: { stravaConnectionId_activityKey: { stravaConnectionId: "sc_1", activityKey: key } },
      create: { stravaConnectionId: "sc_1", activityKey: key },
      update: {},
    });
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("rejects another user's activity", async () => {
    vi.mocked(prisma.stravaActivity.findUnique).mockResolvedValueOnce({
      ...ownedActivity,
      connection: { userId: "someone_else" },
    } as never);

    expect(await dismissStravaMatch("sa_1")).toEqual({ error: "Not authorized" });
    expect(prisma.stravaDismissal.upsert).not.toHaveBeenCalled();
  });
});

describe("dismissAllStravaMatches", () => {
  it("records hashed dismissals only for the caller's own activities", async () => {
    vi.mocked(prisma.stravaActivity.findMany).mockResolvedValueOnce([
      { id: "sa_1", stravaActivityId: "111", stravaConnectionId: "sc_1" },
      { id: "sa_2", stravaActivityId: "222", stravaConnectionId: "sc_1" },
    ] as never);
    mockTransaction.mockResolvedValueOnce([{ count: 2 }, { count: 2 }] as never);

    const result = await dismissAllStravaMatches(["sa_1", "sa_2", "sa_foreign"]);

    expect(prisma.stravaActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["sa_1", "sa_2", "sa_foreign"] }, connection: { userId: "user_1" } },
      }),
    );
    expect(prisma.stravaActivity.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sa_1", "sa_2"] } },
      data: { matchDismissed: true },
    });
    expect(prisma.stravaDismissal.createMany).toHaveBeenCalledWith({
      data: [
        { stravaConnectionId: "sc_1", activityKey: stravaActivityKey("111") },
        { stravaConnectionId: "sc_1", activityKey: stravaActivityKey("222") },
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({ success: true, dismissedCount: 2 });
  });

  it("does nothing when none of the ids are owned", async () => {
    vi.mocked(prisma.stravaActivity.findMany).mockResolvedValueOnce([] as never);

    expect(await dismissAllStravaMatches(["sa_foreign"])).toEqual({ success: true, dismissedCount: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("undismissStravaMatch", () => {
  it("clears the cached flag and deletes the durable dismissal", async () => {
    vi.mocked(prisma.stravaActivity.findUnique).mockResolvedValueOnce(ownedActivity as never);

    expect(await undismissStravaMatch("sa_1")).toEqual({ success: true });
    expect(prisma.stravaActivity.update).toHaveBeenCalledWith({
      where: { id: "sa_1" },
      data: { matchDismissed: false },
    });
    expect(prisma.stravaDismissal.deleteMany).toHaveBeenCalledWith({
      where: { stravaConnectionId: "sc_1", activityKey: stravaActivityKey("9876543210") },
    });
  });
});

describe("attachStravaActivity", () => {
  it("flags the attached link as coming from Strava", async () => {
    vi.mocked(prisma.attendance.findUnique).mockResolvedValueOnce({ userId: "user_1" } as never);
    vi.mocked(prisma.stravaActivity.findUnique).mockResolvedValueOnce(ownedActivity as never);
    vi.mocked(prisma.stravaActivity.findFirst).mockResolvedValueOnce(null);

    expect(await attachStravaActivity("sa_1", "att_1")).toEqual({ success: true });
    expect(prisma.attendance.update).toHaveBeenCalledWith({
      where: { id: "att_1" },
      data: {
        stravaUrl: "https://www.strava.com/activities/9876543210",
        stravaUrlAutoLinked: true,
      },
    });
  });
});

describe("disconnectStrava", () => {
  it("revokes, clears only auto-linked URLs, and deletes the connection", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);
    vi.mocked(getValidAccessToken).mockResolvedValueOnce({ accessToken: "tok", refreshed: false });

    expect(await disconnectStrava()).toEqual({ success: true });
    expect(deauthorizeStrava).toHaveBeenCalledWith("tok");
    expect(prisma.attendance.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", stravaUrlAutoLinked: true },
      data: { stravaUrl: null, stravaUrlAutoLinked: false },
    });
    expect(prisma.stravaConnection.delete).toHaveBeenCalledWith({ where: { id: "sc_1" } });
  });
});

describe("getStravaActivitiesForDate", () => {
  it("refreshes a stale cache before listing that day's activities", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);
    mockSync.mockResolvedValueOnce({ created: 1, updated: 0, removed: 0, total: 1 });
    vi.mocked(prisma.stravaActivity.findMany).mockResolvedValueOnce([] as never);

    const result = await getStravaActivitiesForDate("2026-11-05");

    expect(mockSync).toHaveBeenCalledWith("user_1");
    expect(mockSync.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.stravaActivity.findMany).mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ success: true, activities: [] });
  });

  it("does not sync for a malformed date", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);

    expect(await getStravaActivitiesForDate("Nov 5")).toEqual({
      error: "Invalid date format (expected YYYY-MM-DD)",
    });
    expect(mockSync).not.toHaveBeenCalled();
  });
});
