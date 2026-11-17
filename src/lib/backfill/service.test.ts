import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { backfillRun: { findUnique: vi.fn(), count: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) } } }));
vi.mock("./approval", async (orig) => {
  const actual = await orig<typeof import("./approval")>();
  return { ...actual, checkMergedPrApproval: vi.fn(), fetchPrFiles: vi.fn(), openPrHead: vi.fn() };
});
vi.mock("./apply", () => ({ advanceRun: vi.fn(), runVerification: vi.fn() }));
vi.mock("./plan", () => ({ planBackfill: vi.fn() }));
vi.mock("./run-state", () => ({ acquireLease: vi.fn(), haltRun: vi.fn() }));
vi.mock("./agent", async (orig) => {
  const actual = await orig<typeof import("./agent")>();
  return { ...actual, fetchRunArchive: vi.fn().mockResolvedValue("[]") };
});

import { prisma } from "@/lib/db";
import { checkMergedPrApproval, LabelMissingError, RetryableApprovalError, TerminalApprovalError } from "./approval";
import { advanceRun } from "./apply";
import { acquireLease, haltRun } from "./run-state";
import { advanceFromCaller } from "./service";
import { handlePlanRequest } from "./routes";

const TOKEN = "t".repeat(40);
const run = { id: "run_1", prNumber: 7, status: "APPLYING", mergeSha: "S", stampedSha: "H" };

describe("advanceFromCaller (G1 on every batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.backfillRun.findUnique).mockResolvedValue(run as never);
  });

  it("re-checks approval, re-reads the archive, then takes one step", async () => {
    vi.mocked(checkMergedPrApproval).mockResolvedValue({ prNumber: 7, mergeSha: "S", stampedSha: "H", headSha: "H" });
    vi.mocked(advanceRun).mockResolvedValue({ status: "BATCH_WRITTEN" } as never);
    expect(await advanceFromCaller("run_1", "backfill-agent")).toEqual({ status: "BATCH_WRITTEN" });
    expect(advanceRun).toHaveBeenCalledWith("run_1", expect.objectContaining({ by: "backfill-agent", archiveBytes: "[]" }));
  });

  it("a retryable approval failure writes nothing", async () => {
    vi.mocked(checkMergedPrApproval).mockRejectedValue(new RetryableApprovalError("A3: no stamp yet"));
    expect(await advanceFromCaller("run_1", "backfill-agent")).toEqual({ status: "WAITING", reason: "A3: no stamp yet" });
    expect(advanceRun).not.toHaveBeenCalled();
    expect(haltRun).not.toHaveBeenCalled();
  });

  it("a terminal one (the label removed, a moved head) halts an APPLYING run", async () => {
    vi.mocked(checkMergedPrApproval).mockRejectedValue(new TerminalApprovalError("A2: removed"));
    vi.mocked(acquireLease).mockResolvedValue("lease");
    expect(await advanceFromCaller("run_1", "backfill-agent")).toEqual({ status: "REFUSED", reason: "A2: removed" });
    expect(haltRun).toHaveBeenCalledWith("run_1", "lease", ["A2: removed"]);
  });

  it("refuses when the approval no longer matches the plan's commits", async () => {
    vi.mocked(checkMergedPrApproval).mockResolvedValue({ prNumber: 7, mergeSha: "S", stampedSha: "OTHER", headSha: "OTHER" });
    vi.mocked(acquireLease).mockResolvedValue("lease");
    expect((await advanceFromCaller("run_1", "backfill-agent")).status).toBe("REFUSED");
    expect(advanceRun).not.toHaveBeenCalled();
  });
});

describe("POST /preview and /plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BACKFILL_AGENT_TOKEN", TOKEN);
    vi.stubEnv("BACKFILL_AUTOMATION", "shadow");
  });
  afterEach(() => vi.unstubAllEnvs());

  const post = (body: unknown) => new Request("https://x/api/agent/backfill/plan", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });

  it("needs a PR number, and allows one plan per PR per 10 minutes", async () => {
    expect((await handlePlanRequest(post({}), false)).status).toBe(400);
    vi.mocked(prisma.backfillRun.count).mockResolvedValue(1);
    expect((await handlePlanRequest(post({ prNumber: 7 }), false)).status).toBe(429);
  });

  it("returns a PR's final run without calling GitHub again", async () => {
    vi.mocked(prisma.backfillRun.findFirst).mockResolvedValueOnce({ id: "r", prNumber: 7, status: "BLOCKED", reasonCodes: ["G9: x"], counts: null, cursor: 0, splitDate: null, verification: null, updatedAt: new Date() } as never);
    const res = await handlePlanRequest(post({ prNumber: 7 }), false);
    expect((await res.json()).data.reasons).toEqual(["G9: x"]);
    expect(checkMergedPrApproval).not.toHaveBeenCalled();
  });

  it("a removed label halts an applying run instead of pausing it", async () => {
    vi.mocked(prisma.backfillRun.findUnique).mockResolvedValue(run as never);
    vi.mocked(checkMergedPrApproval).mockRejectedValue(new LabelMissingError("A2: the PR doesn't carry owner-approved"));
    vi.mocked(acquireLease).mockResolvedValue("lease");
    expect((await advanceFromCaller("run_1", "backfill-agent")).status).toBe("REFUSED");
    expect(haltRun).toHaveBeenCalled();
  });

  it("reports a retryable approval failure as WAITING without storing anything", async () => {
    vi.mocked(prisma.backfillRun.count).mockResolvedValue(0);
    vi.mocked(checkMergedPrApproval).mockRejectedValue(new RetryableApprovalError("A1: the deploy doesn't contain the PR yet"));
    const res = await handlePlanRequest(post({ prNumber: 7 }), false);
    expect(res.status).toBe(202);
    expect((await res.json()).data.status).toBe("WAITING");
  });
});
