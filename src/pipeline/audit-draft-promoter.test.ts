import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  pgConnectionOptions: () => ({}),
  prisma: {
    auditFindingDraft: {
      findMany: vi.fn(),
      updateMany: vi.fn(), // used for both the claim and markDraft
    },
  },
}));
vi.mock("@/pipeline/audit-filer", () => ({ fileAuditFinding: vi.fn() }));

// In-memory stand-in for Postgres advisory locks: one holder per key at a time,
// released on COMMIT, ROLLBACK or disconnect, as a transaction-level lock is.
const pgState = vi.hoisted(() => ({ holder: null as object | null, queries: [] as string[] }));
vi.mock("pg", () => ({
  Client: class {
    on() {}
    async connect() {}
    async query(sql: string) {
      pgState.queries.push(sql);
      if (sql.startsWith("SELECT pg_try_advisory_xact_lock")) {
        const locked = pgState.holder === null;
        if (locked) pgState.holder = this;
        return { rows: [{ locked }] };
      }
      if ((sql === "COMMIT" || sql === "ROLLBACK") && pgState.holder === this) pgState.holder = null;
      return { rows: [] };
    }
    async end() {
      if (pgState.holder === this) pgState.holder = null;
    }
  },
}));
vi.mock("@/pipeline/audit-issue", () => ({
  GITHUB_MIN_WRITE_GAP_MS: 1_000,
  buildCronActions: vi.fn(() => ({
    createIssue: vi.fn(),
    postComment: vi.fn(),
    listOpenIssuesByKennel: vi.fn().mockResolvedValue([]),
  })),
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
import { buildCronActions } from "@/pipeline/audit-issue";
import { loadSuppressions } from "@/pipeline/audit-runner";
import {
  DEFAULT_PROMOTER_MAX_DURATION_S,
  MAX_PROMOTIONS_PER_RUN,
  promoteAuditDrafts,
} from "./audit-draft-promoter";
import { maxDuration as routeMaxDuration } from "@/app/api/cron/promote-audit-findings/route";

const mockFindMany = vi.mocked(prisma.auditFindingDraft.findMany);
const mockUpdateMany = vi.mocked(prisma.auditFindingDraft.updateMany);
const mockFile = vi.mocked(fileAuditFinding);
const mockSuppressions = vi.mocked(loadSuppressions);

/** Asserts at least one updateMany call carried `data` matching the given fields
 *  (markDraft uses updateMany; the claim call carries promoteAttempts, not status). */
function expectMarkedWith(data: Record<string, unknown>) {
  expect(mockUpdateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining(data) }),
  );
}

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
  pgState.holder = null;
  pgState.queries = [];
  mockSuppressions.mockResolvedValue(new Set<string>());
  mockUpdateMany.mockResolvedValue({ count: 1 } as never); // CAS claim + marks succeed by default
  mockFile.mockResolvedValue({ action: "created", issueNumber: 42, htmlUrl: "https://x/42" } as never);
});

describe("promoteAuditDrafts", () => {
  it("files a PENDING draft → FILED, records the issue number", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    const summary = await promoteAuditDrafts();
    expect(summary.filed).toBe(1);
    expect(mockFile).toHaveBeenCalledTimes(1);
    expectMarkedWith({ status: "FILED", issueNumber: 42 });
  });

  it.each([
    ["source-coverage-gap", true],
    ["historical-events-gap", true],
    ["hares-theme-leak", false],
  ])("labels a %s draft for onboarding: %s", async (ruleSlug, routed) => {
    mockFindMany.mockResolvedValue([draft({ ruleSlug })] as never);
    await promoteAuditDrafts();
    const { labels } = mockFile.mock.calls[0][0];
    expect(labels).toEqual(expect.arrayContaining(["audit", "alert", "kennel:nych3"]));
    expect(labels.includes("onboarding-candidate")).toBe(routed);
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
    expectMarkedWith({ status: "RECURRED", issueNumber: 7, filerTier: "strict" });
  });

  it("suppresses a kennel+rule draft at promotion time without filing", async () => {
    mockSuppressions.mockResolvedValue(new Set<string>(["nych3::hares-theme-leak"]));
    mockFindMany.mockResolvedValue([draft()] as never);
    const summary = await promoteAuditDrafts();
    expect(summary.suppressed).toBe(1);
    expect(mockFile).not.toHaveBeenCalled();
    expectMarkedWith({ status: "SUPPRESSED" });
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
    expectMarkedWith({ status: "ERROR", errorReason: "create-failed" });
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
    expectMarkedWith({ status: "ERROR", errorReason: "boom" });
  });

  it("caps the scan at MAX_PROMOTIONS_PER_RUN, oldest first", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await promoteAuditDrafts();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_PROMOTIONS_PER_RUN, orderBy: { submittedAt: "asc" } }),
    );
  });

  it("asks for GitHub actions paced a second apart", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await promoteAuditDrafts();
    expect(buildCronActions).toHaveBeenCalledWith({ minWriteGapMs: 1_000 });
  });
});

describe("promoteAuditDrafts run lock", () => {
  it("two concurrent runs file each draft once; the second skips as locked", async () => {
    mockFindMany.mockResolvedValue([
      draft({ id: "d1" }),
      draft({ id: "d2", ruleSlug: "location-leak", title: "NYCH3 location leak" }),
    ] as never);
    // Slow GitHub writes so the two runs overlap.
    mockFile.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { action: "created", issueNumber: 42, htmlUrl: "https://x/42" } as never;
    });

    const [a, b] = await Promise.all([promoteAuditDrafts(), promoteAuditDrafts()]);

    expect(mockFile).toHaveBeenCalledTimes(2);
    expect(mockFile.mock.calls.map(([input]) => input.ruleSlug).sort()).toEqual([
      "hares-theme-leak",
      "location-leak",
    ]);
    const skipped = [a, b].filter((s) => s.skipped === "locked");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ considered: 0, filed: 0 });
    expect([a, b].find((s) => !s.skipped)).toMatchObject({ filed: 2 });
    // The loser read nothing from the queue.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when a run ends, so the next run proceeds", async () => {
    mockFindMany.mockResolvedValue([] as never);
    await promoteAuditDrafts();
    const second = await promoteAuditDrafts();
    expect(second.skipped).toBeUndefined();
    expect(pgState.queries.filter((q) => q === "COMMIT")).toHaveLength(2);
  });

  it("rolls back (releasing the lock) when the run throws", async () => {
    mockSuppressions.mockRejectedValueOnce(new Error("db down"));
    await expect(promoteAuditDrafts()).rejects.toThrow("db down");
    expect(pgState.queries).toContain("ROLLBACK");
    expect(pgState.holder).toBeNull();
  });

  it("sets the idle-transaction timeout to the route's maxDuration + 30 s before taking the lock", async () => {
    expect(routeMaxDuration).toBe(DEFAULT_PROMOTER_MAX_DURATION_S);
    mockFindMany.mockResolvedValue([] as never);
    await promoteAuditDrafts({ maxDurationSeconds: routeMaxDuration });
    expect(pgState.queries.slice(0, 3)).toEqual([
      "SET idle_in_transaction_session_timeout = 330000",
      "BEGIN",
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
    ]);
  });
});

describe("promoteAuditDrafts when GitHub can't answer", () => {
  it("leaves a PENDING draft PENDING with the reason, files nothing, and gives back the attempt", async () => {
    mockFindMany.mockResolvedValue([draft()] as never);
    mockFile.mockResolvedValue({ action: "error", reason: "github-list-failed" } as never);

    const summary = await promoteAuditDrafts();

    expect(summary).toMatchObject({ deferred: 1, errored: 0, filed: 0 });
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "d1", status: "PENDING" },
      data: { errorReason: "github-list-failed", promoteAttempts: { decrement: 1 } },
    });
    // Never moved out of PENDING.
    expect(mockUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: expect.anything() }) }),
    );
  });

  it("stops at the first GitHub list failure and leaves the rest of the batch untouched", async () => {
    mockFindMany.mockResolvedValue([
      draft({ id: "d1" }),
      draft({ id: "d2", ruleSlug: "location-leak" }),
      draft({ id: "d3", ruleSlug: "time-leak" }),
    ] as never);
    mockFile.mockResolvedValue({ action: "error", reason: "github-list-failed" } as never);

    const summary = await promoteAuditDrafts();

    expect(summary).toMatchObject({ considered: 3, deferred: 3, errored: 0 });
    expect(mockFile).toHaveBeenCalledTimes(1);
    // One claim + one give-back for d1; d2 and d3 were never claimed.
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
  });
});
