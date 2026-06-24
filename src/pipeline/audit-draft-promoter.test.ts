import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    auditFindingDraft: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/pipeline/audit-filer", () => ({ fileAuditFinding: vi.fn() }));
vi.mock("@/pipeline/audit-issue", () => ({
  buildCronActions: vi.fn(() => ({ createIssue: vi.fn(), postComment: vi.fn() })),
}));
vi.mock("@/pipeline/audit-runner", () => ({ loadSuppressions: vi.fn() }));
// Deterministic fingerprint per (kennel, rule) so same-finding siblings collide.
vi.mock("@/lib/audit-canonical", () => ({
  buildCanonicalBlock: ({ kennelCode, ruleSlug }: { kennelCode: string; ruleSlug: string }) => ({
    fingerprint: `fp:${kennelCode}:${ruleSlug}`,
  }),
}));

import { prisma } from "@/lib/db";
import { fileAuditFinding } from "@/pipeline/audit-filer";
import { loadSuppressions } from "@/pipeline/audit-runner";
import { promoteAuditDrafts } from "./audit-draft-promoter";

const mockFindMany = vi.mocked(prisma.auditFindingDraft.findMany);
const mockUpdateMany = vi.mocked(prisma.auditFindingDraft.updateMany);
const mockUpdate = vi.mocked(prisma.auditFindingDraft.update);
const mockFile = vi.mocked(fileAuditFinding);
const mockSuppressions = vi.mocked(loadSuppressions);

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    stream: "CHROME_EVENT",
    kennelCode: "nych3",
    ruleSlug: "hares-theme-leak",
    title: "NYCH3 hares theme leak",
    bodyMarkdown: "body",
    status: "PENDING",
    promoteAttempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSuppressions.mockResolvedValue(new Set<string>());
  mockUpdateMany.mockResolvedValue({ count: 1 } as never); // CAS claim wins by default
  mockUpdate.mockResolvedValue({} as never);
  mockFile.mockResolvedValue({ action: "created", issueNumber: 42, htmlUrl: "https://x/42" } as never);
});

describe("promoteAuditDrafts", () => {
  it("files a PENDING draft → FILED, records the issue number", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    const summary = await promoteAuditDrafts();
    expect(summary.filed).toBe(1);
    expect(mockFile).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "FILED", issueNumber: 42 }),
    });
  });

  it("marks a recurred outcome RECURRED with the filer tier", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    mockFile.mockResolvedValue({
      action: "recurred",
      issueNumber: 7,
      htmlUrl: "https://x/7",
      tier: "strict",
      recurrenceCount: 3,
    } as never);
    const summary = await promoteAuditDrafts();
    expect(summary.recurred).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "RECURRED", issueNumber: 7, filerTier: "strict" }),
    });
  });

  it("suppresses a kennel+rule draft at promotion time without filing", async () => {
    mockSuppressions.mockResolvedValue(new Set<string>(["nych3::hares-theme-leak"]));
    mockFindMany.mockResolvedValue([draft()] as never);
    const summary = await promoteAuditDrafts();
    expect(summary.suppressed).toBe(1);
    expect(mockFile).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "SUPPRESSED" }),
    });
  });

  it("honors a global (null-kennel) suppression", async () => {
    mockSuppressions.mockResolvedValue(new Set<string>(["::hares-theme-leak"]));
    mockFindMany.mockResolvedValue([draft()] as never);
    const summary = await promoteAuditDrafts();
    expect(summary.suppressed).toBe(1);
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("marks a filer error ERROR (retryable) without throwing", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    mockFile.mockResolvedValue({ action: "error", reason: "create-failed" } as never);
    const summary = await promoteAuditDrafts();
    expect(summary.errored).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "ERROR", errorReason: "create-failed" }),
    });
  });

  it("rejects a draft whose kennel was deleted (kennelCode null), never files", async () => {
    mockFindMany.mockResolvedValue([draft({ id: "d2", kennelCode: null })] as never);
    const summary = await promoteAuditDrafts();
    expect(summary.rejected).toBe(1);
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("skips a draft when the CAS claim is lost (concurrent promoter / rejected)", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    mockUpdateMany.mockResolvedValue({ count: 0 } as never);
    const summary = await promoteAuditDrafts();
    expect(mockFile).not.toHaveBeenCalled();
    expect(summary.filed).toBe(0);
  });

  it("guards the claim on status so a rejected draft isn't published", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    await promoteAuditDrafts();
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PENDING" }) }),
    );
  });

  it("defers a same-fingerprint sibling to a later run (no in-batch duplicate create)", async () => {
    mockFindMany.mockResolvedValue([
      draft({ id: "a" }),
      draft({ id: "b", title: "different wording, same kennel+rule" }),
    ] as never);
    const summary = await promoteAuditDrafts();
    expect(mockFile).toHaveBeenCalledTimes(1); // only the first sibling is filed
    expect(summary.filed).toBe(1);
    expect(summary.deferred).toBe(1);
  });

  it("isolates a thrown error to one draft and keeps processing the rest", async () => {
    mockFindMany.mockResolvedValue([
      draft({ id: "x" }),
      draft({ id: "y", kennelCode: "other", ruleSlug: "location-url" }),
    ] as never);
    mockFile
      .mockRejectedValueOnce(new Error("boom") as never)
      .mockResolvedValueOnce({ action: "created", issueNumber: 9, htmlUrl: "https://x/9" } as never);
    const summary = await promoteAuditDrafts();
    expect(summary.errored).toBe(1);
    expect(summary.filed).toBe(1); // the second draft still got filed
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "x" },
      data: expect.objectContaining({ status: "ERROR", errorReason: "boom" }),
    });
  });

  it("caps the scan at MAX_PROMOTIONS_PER_RUN", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await promoteAuditDrafts();
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 12 }));
  });
});
