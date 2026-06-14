import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

// Stub the client dashboard so importing the page doesn't pull in recharts.
vi.mock("@/components/admin/AnalyticsDashboard", () => ({
  AnalyticsDashboard: () => null,
}));

// Stub the data loaders so a successful render never touches prisma, and so we
// can assert they don't run when the admin guard rejects.
vi.mock("./actions", () => ({
  getCommunityHealthMetrics: vi.fn().mockResolvedValue({}),
  getUserEngagementMetrics: vi.fn().mockResolvedValue({}),
  getOperationalHealthMetrics: vi.fn().mockResolvedValue({}),
}));

import { requireAdmin } from "@/lib/admin/require-admin";
import { mockAdminUser } from "@/test/factories";
import AnalyticsPage from "./page";
import {
  getCommunityHealthMetrics,
  getUserEngagementMetrics,
  getOperationalHealthMetrics,
} from "./actions";

const mockRequireAdmin = vi.mocked(requireAdmin);

describe("AnalyticsPage auth boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed and visibly when the admin guard rejects — does not swallow auth into empty data", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(AnalyticsPage()).rejects.toThrow("Unauthorized");

    // The guard runs before Promise.allSettled, so loaders never execute and the
    // rejection can't be laundered into EMPTY_* dashboard data.
    expect(getCommunityHealthMetrics).not.toHaveBeenCalled();
    expect(getUserEngagementMetrics).not.toHaveBeenCalled();
    expect(getOperationalHealthMetrics).not.toHaveBeenCalled();
  });

  it("renders for an authorized admin", async () => {
    mockRequireAdmin.mockResolvedValueOnce(mockAdminUser);

    await expect(AnalyticsPage()).resolves.toBeDefined();
    expect(getCommunityHealthMetrics).toHaveBeenCalled();
  });
});
