import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

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
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    event: {
      findMany: vi.fn(),
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
  revokeStravaToken: vi.fn(),
}));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncStravaActivities } from "@/lib/strava/sync";
import { revokeStravaToken } from "@/lib/strava/client";
import { stravaActivityKey } from "@/lib/strava/activity-key";
import { buildStravaActivity, mockUser } from "@/test/factories";
import {
  syncStravaIfStale,
  triggerStravaSync,
  dismissStravaMatch,
  dismissAllStravaMatches,
  undismissStravaMatch,
  disconnectStrava,
  attachStravaActivity,
  getStravaActivitiesForDate,
  getLinkedStravaActivity,
  getStravaBackfillActivities,
} from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockSync = vi.mocked(syncStravaActivities);
const mockTransaction = vi.mocked(prisma.$transaction);

/** The factory activity (sa_1 / sc_1 / Strava ID 9876543210), owned by user_1. */
const ownedActivity = { ...buildStravaActivity(), connection: { userId: "user_1" } };
const OWNED_KEY = stravaActivityKey("9876543210");

const syncResult = (overrides: Partial<Awaited<ReturnType<typeof syncStravaActivities>>> = {}) => ({
  created: 0, updated: 0, total: 0, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
  mockTransaction.mockResolvedValue([{ count: 0 }, { count: 0 }] as never);
  mockSync.mockResolvedValue(syncResult({ skipped: true }));
});

describe("syncStravaIfStale", () => {
  it("runs a non-forced sync so a fresh cache is left alone", async () => {
    const result = await syncStravaIfStale();

    expect(mockSync).toHaveBeenCalledWith("user_1");
    expect(result).toEqual({ success: true, synced: false });
  });

  it("reports a completed sync", async () => {
    mockSync.mockResolvedValueOnce(syncResult({ created: 2, updated: 1, total: 3 }));

    expect(await syncStravaIfStale()).toEqual({ success: true, synced: true });
  });

  it("surfaces sync errors instead of failing silently", async () => {
    mockSync.mockResolvedValueOnce(
      syncResult({ error: "Strava token refresh failed (401): Authorization Error" }),
    );

    expect(await syncStravaIfStale()).toEqual({
      error: "Strava token refresh failed (401): Authorization Error",
    });
  });

  it("requires authentication", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await syncStravaIfStale()).toEqual({ error: "Not authenticated" });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("triggerStravaSync", () => {
  it("forces a sync and reports the activity count", async () => {
    mockSync.mockResolvedValueOnce(syncResult({ total: 7 }));

    expect(await triggerStravaSync()).toEqual({ success: true, syncedCount: 7 });
    expect(mockSync).toHaveBeenCalledWith("user_1", { forceRefresh: true });
  });

  it("returns the sync error", async () => {
    mockSync.mockResolvedValueOnce(syncResult({ error: "Strava rate limit exceeded." }));

    expect(await triggerStravaSync()).toEqual({ error: "Strava rate limit exceeded." });
  });
});

describe("dismissStravaMatch", () => {
  it("flags the cached row and records a durable hashed dismissal", async () => {
    vi.mocked(prisma.stravaActivity.findUnique).mockResolvedValueOnce(ownedActivity as never);

    expect(await dismissStravaMatch("sa_1")).toEqual({ success: true });
    expect(prisma.stravaActivity.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sa_1"] } },
      data: { matchDismissed: true },
    });
    expect(prisma.stravaDismissal.createMany).toHaveBeenCalledWith({
      data: [{ stravaConnectionId: "sc_1", activityKey: OWNED_KEY }],
      skipDuplicates: true,
    });
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("rejects another user's activity", async () => {
    vi.mocked(prisma.stravaActivity.findUnique).mockResolvedValueOnce({
      ...ownedActivity,
      connection: { userId: "someone_else" },
    } as never);

    expect(await dismissStravaMatch("sa_1")).toEqual({ error: "Not authorized" });
    expect(mockTransaction).not.toHaveBeenCalled();
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
    expect(prisma.stravaActivity.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["sa_1"] } },
      data: { matchDismissed: false },
    });
    expect(prisma.stravaDismissal.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ stravaConnectionId: "sc_1", activityKey: OWNED_KEY }] },
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
  it("revokes the refresh token, clears only auto-linked URLs, and deletes the connection", async () => {
    // Legacy plaintext token: decryptToken passes it through unchanged
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({
      id: "sc_1", refreshToken: "refresh_xyz",
    } as never);

    expect(await disconnectStrava()).toEqual({ success: true });
    expect(revokeStravaToken).toHaveBeenCalledWith("refresh_xyz", "refresh_token");
    expect(prisma.attendance.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", stravaUrlAutoLinked: true },
      data: { stravaUrl: null, stravaUrlAutoLinked: false },
    });
    expect(prisma.stravaConnection.delete).toHaveBeenCalledWith({ where: { id: "sc_1" } });
  });

  it("still cleans up locally when Strava revocation fails", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({
      id: "sc_1", refreshToken: "refresh_xyz",
    } as never);
    vi.mocked(revokeStravaToken).mockRejectedValueOnce(new Error("Strava token revocation failed (401)"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await disconnectStrava()).toEqual({ success: true });
    expect(prisma.stravaConnection.delete).toHaveBeenCalledWith({ where: { id: "sc_1" } });
    consoleSpy.mockRestore();
  });
});

// Cache readers that run outside the logbook panel must refresh a stale or
// purged cache before reading it.
describe("cache readers refresh the transient cache first", () => {
  const syncedBeforeRead = (read: ReturnType<typeof vi.fn>) =>
    mockSync.mock.invocationCallOrder[0] < read.mock.invocationCallOrder[0];

  it("getStravaActivitiesForDate (post-check-in picker)", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);
    vi.mocked(prisma.stravaActivity.findMany).mockResolvedValueOnce([] as never);

    expect(await getStravaActivitiesForDate("2026-11-05")).toEqual({ success: true, activities: [] });
    expect(mockSync).toHaveBeenCalledWith("user_1");
    expect(syncedBeforeRead(vi.mocked(prisma.stravaActivity.findMany))).toBe(true);
  });

  it("getLinkedStravaActivity (linked activity details)", async () => {
    vi.mocked(prisma.attendance.findUnique).mockResolvedValueOnce({ userId: "user_1" } as never);
    vi.mocked(prisma.stravaActivity.findFirst).mockResolvedValueOnce(null);

    expect(await getLinkedStravaActivity("att_1")).toEqual({ success: true, activity: null });
    expect(syncedBeforeRead(vi.mocked(prisma.stravaActivity.findFirst))).toBe(true);
  });

  it("getStravaBackfillActivities (onboarding backfill wizard)", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);
    vi.mocked(prisma.stravaActivity.findMany).mockResolvedValueOnce([] as never);

    expect(await getStravaBackfillActivities()).toEqual({ success: true, activities: [] });
    expect(syncedBeforeRead(vi.mocked(prisma.stravaActivity.findMany))).toBe(true);
  });

  it("still serves the cache when the refresh throws", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);
    mockSync.mockRejectedValueOnce(new Error("P2028 transaction timeout"));
    vi.mocked(prisma.stravaActivity.findMany).mockResolvedValueOnce([] as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await getStravaActivitiesForDate("2026-11-05")).toEqual({ success: true, activities: [] });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does not sync for a malformed picker date", async () => {
    vi.mocked(prisma.stravaConnection.findUnique).mockResolvedValueOnce({ id: "sc_1" } as never);

    expect(await getStravaActivitiesForDate("Nov 5")).toEqual({
      error: "Invalid date format (expected YYYY-MM-DD)",
    });
    expect(mockSync).not.toHaveBeenCalled();
  });
});
