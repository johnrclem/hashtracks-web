import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    backfillRun: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("./service", () => ({ advanceFromCaller: vi.fn(), planFromPr: vi.fn(), verifyFromCaller: vi.fn() }));
vi.mock("./approval", () => ({ listApprovedManifestPrs: vi.fn().mockResolvedValue([]), RetryableApprovalError: class extends Error {} }));

import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { advanceFromCaller, planFromPr } from "./service";
import { listApprovedManifestPrs } from "./approval";
import { runBackfillWatch } from "./watch";

const NOW = new Date("2026-11-20T07:15:00Z");

describe("backfill-watch (7.3, 11.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.backfillRun.findMany).mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("off: touches no run (the route's withCronRun records liveness)", async () => {
    vi.stubEnv("BACKFILL_AUTOMATION", "off");
    const report = await runBackfillWatch(NOW);
    expect(report.mode).toBe("off");
    expect(advanceFromCaller).not.toHaveBeenCalled();
    expect(planFromPr).not.toHaveBeenCalled();
  });

  it("apply: resumes APPLYING runs with an expired lease, and never advances a PLANNED run", async () => {
    vi.stubEnv("BACKFILL_AUTOMATION", "apply");
    vi.mocked(prisma.backfillRun.findMany).mockImplementation((async (args: { where: { status?: unknown } }) =>
      args.where.status === "APPLYING" ? [{ id: "run_1" }] : []) as never);
    vi.mocked(advanceFromCaller).mockResolvedValue({ status: "BATCH_WRITTEN" } as never);
    const report = await runBackfillWatch(NOW);
    expect(advanceFromCaller).toHaveBeenCalledWith("run_1", "backfill-watch");
    expect(report.resumed).toEqual(["run_1:BATCH_WRITTEN"]);
    const where = vi.mocked(prisma.backfillRun.findMany).mock.calls.map((c) => (c[0] as { where: { status?: unknown } }).where.status);
    expect(where).not.toContain("PLANNED");
  });

  it("shadow: plans an approved manifest with no run, and alerts when one is still unverified 48 h after merge", async () => {
    vi.stubEnv("BACKFILL_AUTOMATION", "shadow");
    vi.mocked(listApprovedManifestPrs).mockResolvedValue([{ prNumber: 42, mergedAt: "2026-11-17T00:00:00Z" }]);
    const report = await runBackfillWatch(NOW);
    expect(planFromPr).toHaveBeenCalledWith(42, false, "backfill-watch");
    expect(advanceFromCaller).not.toHaveBeenCalled();
    expect(report.alerts.join()).toMatch(/#42/);
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });
});
