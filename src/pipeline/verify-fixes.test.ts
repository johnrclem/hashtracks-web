import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    alert: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { verifyResolvedAutoFixes } from "./verify-fixes";

const mockAlertFindMany = vi.mocked(prisma.alert.findMany);
const mockAlertUpdate = vi.mocked(prisma.alert.update);

let savedToken: string | undefined;
let savedRepository: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedToken = process.env.GITHUB_TOKEN;
  savedRepository = process.env.GITHUB_REPOSITORY;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = savedToken;
  }
  if (savedRepository === undefined) {
    delete process.env.GITHUB_REPOSITORY;
  } else {
    process.env.GITHUB_REPOSITORY = savedRepository;
  }
});

describe("verifyResolvedAutoFixes", () => {
  it("returns early when GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
    expect(mockAlertFindMany).not.toHaveBeenCalled();
  });

  it("returns early when GITHUB_REPOSITORY is not set", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    delete process.env.GITHUB_REPOSITORY;
    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
    expect(mockAlertFindMany).not.toHaveBeenCalled();
  });

  it("returns 0 when no resolved alerts with auto-filed issues exist", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "test/repo";

    mockAlertFindMany.mockResolvedValueOnce([] as never);

    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
  });

  it("skips alerts without auto_file_issue in repairLog", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "test/repo";

    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "STRUCTURE_CHANGE",
        repairLog: [{ action: "rescrape", timestamp: "2026-01-01T00:00:00Z" }],
      },
    ] as never);

    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it("skips alerts already marked as verified", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "test/repo";

    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "STRUCTURE_CHANGE",
        repairLog: [
          { action: "auto_file_issue", details: { issueNumber: 42 } },
          { action: "auto_fix_verified", details: { issueNumber: 42 } },
        ],
      },
    ] as never);

    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it("verifies a resolved alert with pending-verification label", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "test/repo";

    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "STRUCTURE_CHANGE",
        repairLog: [
          { action: "auto_file_issue", details: { issueNumber: 42, issueUrl: "https://github.com/test/42" } },
        ],
      },
    ] as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // issueHasLabel → returns labels including pending-verification
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ name: "alert" }, { name: "pending-verification" }],
    } as Response);

    // removeLabelFromIssue → success
    fetchSpy.mockResolvedValueOnce({ ok: true } as Response);

    // postVerificationComment → success
    fetchSpy.mockResolvedValueOnce({ ok: true } as Response);

    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 1 });

    // Verify label check
    expect(fetchSpy.mock.calls[0][0]).toContain("/issues/42/labels");

    // Verify label removal
    expect(fetchSpy.mock.calls[1][0]).toContain("/issues/42/labels/pending-verification");
    expect((fetchSpy.mock.calls[1][1] as RequestInit).method).toBe("DELETE");

    // Verify comment posted
    expect(fetchSpy.mock.calls[2][0]).toContain("/issues/42/comments");
    expect((fetchSpy.mock.calls[2][1] as RequestInit).method).toBe("POST");

    // Verify repairLog updated with verification entry
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert_1" },
        data: expect.objectContaining({
          repairLog: expect.arrayContaining([
            expect.objectContaining({ action: "auto_fix_verified", result: "success" }),
          ]),
        }),
      }),
    );
  });

  it("skips alerts where issue lacks pending-verification label", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "test/repo";

    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "STRUCTURE_CHANGE",
        repairLog: [
          { action: "auto_file_issue", details: { issueNumber: 42 } },
        ],
      },
    ] as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // issueHasLabel → no pending-verification label
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ name: "alert" }, { name: "claude-fix" }],
    } as Response);

    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it("handles GitHub API failure gracefully", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "test/repo";

    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "STRUCTURE_CHANGE",
        repairLog: [
          { action: "auto_file_issue", details: { issueNumber: 42 } },
        ],
      },
    ] as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // issueHasLabel → API failure
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const result = await verifyResolvedAutoFixes("src_1");
    expect(result).toEqual({ verified: 0 });
  });
});
