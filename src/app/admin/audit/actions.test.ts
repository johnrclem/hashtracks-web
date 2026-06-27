import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
    },
    auditSuppression: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    kennel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    auditIssue: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));
vi.mock("@/pipeline/audit-issue-sync", () => ({
  syncAuditIssues: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, opts: { code: string }) {
        super(message);
        this.code = opts.code;
      }
    },
  },
  // Mirror the Prisma-generated enums so getStreamTrends/getOpenIssueCountsByStream
  // can reference AuditStream.* / AuditIssueEventType.* at module init time.
  AuditStream: {
    AUTOMATED: "AUTOMATED",
    CHROME_EVENT: "CHROME_EVENT",
    CHROME_KENNEL: "CHROME_KENNEL",
    UNKNOWN: "UNKNOWN",
  },
  AuditIssueEventType: {
    OPENED: "OPENED",
    CLOSED: "CLOSED",
    REOPENED: "REOPENED",
    RELABELED: "RELABELED",
  },
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { syncAuditIssues, type SyncResult } from "@/pipeline/audit-issue-sync";
import { revalidatePath } from "next/cache";
import { buildPrismaUniqueViolation } from "@/test/factories";
import {
  getAuditTrends,
  getTopOffenders,
  getRecentRuns,
  getSuppressions,
  createSuppression,
  deleteSuppression,
  getSuppressionImpact,
  getDeepDiveQueue,
  getDeepDiveCoverage,
  getCloseReasonRatiosByStream,
  getDeepDiveQueueToken,
  recordDeepDive,
  recordDeepDiveManual,
  lookupKennelForDeepDive,
  getAuditSyncFreshness,
  resyncAuditIssues,
} from "./actions";
import {
  computeQueueSnapshotId,
  computeQueueTokenExpiresAt,
  signQueueToken,
} from "@/lib/queue-snapshot-token";

const mockAdmin = vi.mocked(getAdminUser);
const mockLogFind = vi.mocked(prisma.auditLog.findMany);
const mockSupFind = vi.mocked(prisma.auditSuppression.findMany);
const mockSupCreate = vi.mocked(prisma.auditSuppression.create);
const mockSupDeleteMany = vi.mocked(prisma.auditSuppression.deleteMany);
const mockIssueAggregate = vi.mocked(prisma.auditIssue.aggregate);
const mockSync = vi.mocked(syncAuditIssues);
const mockRevalidate = vi.mocked(revalidatePath);

// getAuditSyncFreshness only reads `_max.syncedAt`, but Prisma's aggregate
// return type also carries _count/_avg/_sum/_min. Build the minimal shape
// the action uses and widen it once here rather than asserting per call.
type AuditIssueAggregate = Awaited<ReturnType<typeof prisma.auditIssue.aggregate>>;
function aggregateWithSyncedAt(syncedAt: Date | null): AuditIssueAggregate {
  return { _max: { syncedAt } } as unknown as AuditIssueAggregate;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to authenticated admin for read tests; individual tests override.
  mockAdmin.mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
});

describe("auth guards on read actions", () => {
  it("getAuditTrends rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getAuditTrends()).rejects.toThrow("Unauthorized");
  });
  it("getTopOffenders rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getTopOffenders()).rejects.toThrow("Unauthorized");
  });
  it("getRecentRuns rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getRecentRuns()).rejects.toThrow("Unauthorized");
  });
  it("getSuppressions rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getSuppressions()).rejects.toThrow("Unauthorized");
  });
  it("getSuppressionImpact rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getSuppressionImpact("X", "hare-url")).rejects.toThrow("Unauthorized");
  });
});

describe("getAuditTrends", () => {
  it("aggregates summary JSON across days", async () => {
    mockLogFind.mockResolvedValue([
      { createdAt: new Date("2026-04-01T12:00:00Z"), summary: { hares: 2, title: 1 } },
      { createdAt: new Date("2026-04-01T13:00:00Z"), summary: { hares: 3, location: 1 } },
      { createdAt: new Date("2026-04-02T12:00:00Z"), summary: { event: 4 } },
    ] as never);

    const result = await getAuditTrends(7);
    expect(result).toHaveLength(2);
    const apr1 = result.find(r => r.date === "2026-04-01")!;
    expect(apr1.hares).toBe(5);
    expect(apr1.title).toBe(1);
    expect(apr1.location).toBe(1);
    expect(apr1.total).toBe(7);
  });
});

describe("getTopOffenders", () => {
  it("aggregates by kennelCode + rule and flags suppressed entries", async () => {
    mockLogFind.mockResolvedValue([
      {
        createdAt: new Date("2026-04-04T12:00:00Z"),
        findings: [
          { kennelCode: "NYCH3", kennelShortName: "NYCH3", rule: "hare-cta-text", category: "hares" },
          { kennelCode: "NYCH3", kennelShortName: "NYCH3", rule: "hare-cta-text", category: "hares" },
          { kennelCode: "BFM", kennelShortName: "BFM", rule: "title-cta-text", category: "title" },
        ],
      },
    ] as never);
    mockSupFind.mockResolvedValue([{ kennelCode: "NYCH3", rule: "hare-cta-text" }] as never);

    const result = await getTopOffenders();
    expect(result).toHaveLength(2);
    const cta = result.find(r => r.kennelCode === "NYCH3")!;
    expect(cta.count).toBe(2);
    expect(cta.suppressed).toBe(true);
    const title = result.find(r => r.kennelCode === "BFM")!;
    expect(title.suppressed).toBe(false);
  });

  it("flags global suppressions", async () => {
    mockLogFind.mockResolvedValue([
      {
        createdAt: new Date("2026-04-04T12:00:00Z"),
        findings: [
          { kennelCode: "X", kennelShortName: "X", rule: "hare-url", category: "hares" },
        ],
      },
    ] as never);
    mockSupFind.mockResolvedValue([{ kennelCode: null, rule: "hare-url" }] as never);

    const result = await getTopOffenders();
    expect(result[0].suppressed).toBe(true);
  });
});

describe("createSuppression", () => {
  it("rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(
      createSuppression({ kennelCode: "X", rule: "hare-url", reason: "long enough reason" }),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects unknown rules", async () => {
    mockAdmin.mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
    await expect(
      createSuppression({ kennelCode: "X", rule: "made-up-rule", reason: "long enough reason" }),
    ).rejects.toThrow("Unknown audit rule");
  });

  it("rejects short reasons", async () => {
    mockAdmin.mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
    await expect(
      createSuppression({ kennelCode: "X", rule: "hare-url", reason: "short" }),
    ).rejects.toThrow("at least 10 characters");
  });

  it("surfaces P2002 with friendly message", async () => {
    mockAdmin.mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
    mockSupCreate.mockRejectedValue(buildPrismaUniqueViolation(["kennelId", "rule"]));
    await expect(
      createSuppression({ kennelCode: "X", rule: "hare-url", reason: "long enough reason" }),
    ).rejects.toThrow("already exists");
  });

  it("re-throws non-P2002 errors as-is", async () => {
    mockAdmin.mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
    mockSupCreate.mockRejectedValue(new Error("boom"));
    await expect(
      createSuppression({ kennelCode: "X", rule: "hare-url", reason: "long enough reason" }),
    ).rejects.toThrow("boom");
  });

  it("inserts and stores creator email", async () => {
    mockAdmin.mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
    mockSupCreate.mockResolvedValue({
      id: "sup_1",
      kennelCode: "NYCH3",
      rule: "hare-url",
      reason: "test reason here",
      createdBy: "a@b.com",
      createdAt: new Date(),
      kennel: { shortName: "NYCH3" },
    } as never);

    await createSuppression({ kennelCode: "NYCH3", rule: "hare-url", reason: "test reason here" });
    expect(mockSupCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdBy: "a@b.com" }),
      }),
    );
  });
});

describe("deleteSuppression", () => {
  it("requires admin", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(deleteSuppression("sup_1")).rejects.toThrow("Unauthorized");
  });

  it("uses deleteMany so missing rows don't throw", async () => {
    mockSupDeleteMany.mockResolvedValue({ count: 0 } as never);
    await expect(deleteSuppression("sup_missing")).resolves.toBeUndefined();
    expect(mockSupDeleteMany).toHaveBeenCalledWith({ where: { id: "sup_missing" } });
  });
});

describe("getSuppressionImpact", () => {
  it("counts findings matching kennel + rule", async () => {
    mockLogFind.mockResolvedValue([
      {
        findings: [
          { kennelCode: "X", rule: "hare-url" },
          { kennelCode: "X", rule: "hare-url" },
          { kennelCode: "Y", rule: "hare-url" },
          { kennelCode: "X", rule: "hare-cta-text" },
        ],
      },
    ] as never);

    const result = await getSuppressionImpact("X", "hare-url");
    expect(result.totalFindings).toBe(2);
  });

  it("counts globally when kennelCode is null", async () => {
    mockLogFind.mockResolvedValue([
      {
        findings: [
          { kennelCode: "X", rule: "hare-url" },
          { kennelCode: "Y", rule: "hare-url" },
        ],
      },
    ] as never);
    const result = await getSuppressionImpact(null, "hare-url");
    expect(result.totalFindings).toBe(2);
  });
});

describe("getDeepDiveQueue", () => {
  const mockKennelFind = vi.mocked(prisma.kennel.findMany);
  const mockLogGroupBy = vi.mocked(prisma.auditLog.groupBy);

  it("requires admin", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getDeepDiveQueue()).rejects.toThrow("Unauthorized");
  });

  it("ranks never-dived kennels first, then by oldest dive date", async () => {
    mockKennelFind.mockResolvedValue([
      {
        kennelCode: "BFM",
        shortName: "BFM",
        slug: "bfm",
        region: "Philly",
        sources: [{ source: { type: "ICAL_FEED", url: "https://x", name: "BFM iCal" } }],
        _count: { events: 12 },
      },
      {
        kennelCode: "NYCH3",
        shortName: "NYCH3",
        slug: "nych3",
        region: "NYC",
        sources: [{ source: { type: "HTML_SCRAPER", url: "https://hashnyc.com", name: "hashnyc" } }],
        _count: { events: 47 },
      },
      {
        kennelCode: "PSH3",
        shortName: "PSH3",
        slug: "psh3",
        region: "Seattle",
        sources: [{ source: { type: "GOOGLE_SHEETS", url: "https://x", name: "PSH3 sheet" } }],
        _count: { events: 8 },
      },
    ] as never);
    mockLogGroupBy.mockResolvedValue([
      { kennelCode: "BFM", _max: { createdAt: new Date("2026-04-01") } },
      { kennelCode: "NYCH3", _max: { createdAt: new Date("2026-03-15") } },
      // PSH3 has no entry → never dived
    ] as never);

    const result = await getDeepDiveQueue(10);
    expect(result.map(k => k.kennelCode)).toEqual(["PSH3", "NYCH3", "BFM"]);
    expect(result[0].lastDeepDiveAt).toBeNull();
    expect(result[2].lastDeepDiveAt).toEqual(new Date("2026-04-01"));
  });

  it("limits the result", async () => {
    mockKennelFind.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        kennelCode: `K${i}`,
        shortName: `Kennel ${i}`,
        slug: `k${i}`,
        region: "X",
        sources: [],
        _count: { events: 1 },
      })) as never,
    );
    mockLogGroupBy.mockResolvedValue([] as never);
    const result = await getDeepDiveQueue(2);
    expect(result).toHaveLength(2);
  });
});

describe("getDeepDiveCoverage", () => {
  const mockKennelCount = vi.mocked(prisma.kennel.count);

  it("computes coverage stats and projected full cycle", async () => {
    // Two parallel count() calls: total active, then active+audited
    mockKennelCount.mockResolvedValueOnce(100 as never).mockResolvedValueOnce(3 as never);

    const result = await getDeepDiveCoverage();
    expect(result.audited).toBe(3);
    expect(result.total).toBe(100);
    expect(result.percent).toBe(3);
    expect(result.projectedFullCycleDate).not.toBeNull();
  });

  it("returns null projection when fully covered", async () => {
    mockKennelCount.mockResolvedValueOnce(2 as never).mockResolvedValueOnce(2 as never);
    const result = await getDeepDiveCoverage();
    expect(result.percent).toBe(100);
    expect(result.projectedFullCycleDate).toBeNull();
  });

  it("clamps audited to total even if backend returns inconsistent values", async () => {
    mockKennelCount.mockResolvedValueOnce(5 as never).mockResolvedValueOnce(5 as never);
    const result = await getDeepDiveCoverage();
    expect(result.audited).toBeLessThanOrEqual(result.total);
  });
});

describe("recordDeepDive", () => {
  const mockLogCreate = vi.mocked(prisma.auditLog.create);
  const mockLogFindFirst = vi.mocked(prisma.auditLog.findFirst);
  const mockKennelFind = vi.mocked(prisma.kennel.findMany);
  const mockKennelFindUnique = vi.mocked(prisma.kennel.findUnique);
  const mockLogGroupBy = vi.mocked(prisma.auditLog.groupBy);

  const ORIGINAL_SECRET = process.env.AUDIT_QUEUE_TOKEN_SECRET;
  beforeEach(() => {
    process.env.AUDIT_QUEUE_TOKEN_SECRET = "test-secret-for-queue-tokens";
    // No prior dive by default — the idempotency guard finds nothing
    // and the create path runs. Replay tests override this.
    mockLogFindFirst.mockResolvedValue(null as never);
    // The kennel exists by default — the #2282 gate is now an existence
    // check, not top-20 queue membership. The "kennel no longer exists"
    // test overrides this to null.
    mockKennelFindUnique.mockResolvedValue({ id: "k_nych3" } as never);
    // Default queue (used by getDeepDiveQueueToken on the mint side). The
    // submit-side gate no longer reads this, so a churned/removed list here
    // is benign — see the #2282 test below.
    mockKennelFind.mockResolvedValue([
      {
        kennelCode: "nych3",
        shortName: "NYCH3",
        slug: "nych3",
        region: "New York City, NY",
        sources: [],
        _count: { events: 5 },
      },
      {
        kennelCode: "agnews",
        shortName: "AGNEWS",
        slug: "agnews",
        region: "Atlanta, GA",
        sources: [],
        _count: { events: 3 },
      },
    ] as never);
    mockLogGroupBy.mockResolvedValue([] as never);
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.AUDIT_QUEUE_TOKEN_SECRET;
    } else {
      process.env.AUDIT_QUEUE_TOKEN_SECRET = ORIGINAL_SECRET;
    }
  });

  function freshToken(kennelCode: string, kennelCodes: string[] = ["nych3", "agnews"]): string {
    return signQueueToken({
      kennelCode,
      queueSnapshotId: computeQueueSnapshotId(kennelCodes),
      expiresAt: computeQueueTokenExpiresAt(),
    });
  }

  it("requires admin", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(
      recordDeepDive({
        kennelCode: "nych3",
        findingsCount: 1,
        summary: "test",
        queueToken: freshToken("nych3"),
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects empty kennelCode", async () => {
    await expect(
      recordDeepDive({
        kennelCode: "",
        findingsCount: 1,
        summary: "test",
        queueToken: "anything",
      }),
    ).rejects.toThrow("kennelCode is required");
  });

  it("rejects negative findings count", async () => {
    await expect(
      recordDeepDive({
        kennelCode: "nych3",
        findingsCount: -1,
        summary: "test",
        queueToken: freshToken("nych3"),
      }),
    ).rejects.toThrow("findingsCount must be ≥ 0");
  });

  it("rejects when no token is supplied (defense against pre-#1160 callers)", async () => {
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "test",
      queueToken: "",
    });
    expect(result).toEqual({ ok: false, error: "invalidToken" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a token whose kennelCode doesn't match the submission", async () => {
    // Token signed for AGNEWS, submission claims NYCH3. Without
    // this guard, an attacker who captured a token for one kennel
    // could spend it on a different kennel still in the queue.
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "test",
      queueToken: freshToken("agnews"),
    });
    expect(result).toEqual({ ok: false, error: "invalidToken" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("returns kennelGone when the kennel no longer exists (410-shape)", async () => {
    // Token was minted for NYCH3, but the kennel record has since been
    // deleted/merged. The existence check fails closed rather than writing a
    // dangling KENNEL_DEEP_DIVE row.
    mockKennelFindUnique.mockResolvedValue(null as never);
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "test",
      queueToken: freshToken("nych3"),
    });
    expect(result).toEqual({ ok: false, error: "kennelGone" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("persists the dive when the kennel dropped out of the displayed top-20 queue but still exists (#2282)", async () => {
    // The #2282 regression: Fool Moon H3 was a valid never-dived target at
    // dialog-open but a benign queue churn pushed it past the displayed
    // top-20 window by submit time. The old gate re-checked top-20 membership
    // and returned kennelGone — a silent no-op. The kennel still EXISTS, the
    // token is bound to it, so the completion MUST persist.
    mockLogCreate.mockResolvedValue({ id: "log_2282" } as never);
    // Simulate the submit-side mint-queue no longer containing nych3.
    mockKennelFind.mockResolvedValue([] as never);
    // ...but the kennel record itself is alive.
    mockKennelFindUnique.mockResolvedValue({ id: "k_nych3" } as never);
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "boundary kennel completion",
      queueToken: freshToken("nych3"),
    });
    expect(result).toEqual({ ok: true, id: "log_2282" });
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "KENNEL_DEEP_DIVE",
          kennelCode: "nych3",
        }),
      }),
    );
  });

  it("persists the dive when the rest of the queue churned but the kennel is still present (#2261 — no false queueChanged)", async () => {
    // Token was minted with snapshot of [nych3, agnews]; by submit
    // time the live queue also has philly-h3 (a daily cron ingest or
    // a parallel admin shifted the top-20). NYCH3 is still in the
    // queue and the token is cryptographically bound to it, so the
    // credit is unambiguous — the dive MUST persist rather than
    // silently no-op. The full-queue snapshot adds no misattribution
    // safety beyond the kennelCode binding, so its divergence here is
    // benign.
    mockLogCreate.mockResolvedValue({ id: "log_churn" } as never);
    mockKennelFind.mockResolvedValue([
      {
        kennelCode: "nych3",
        shortName: "NYCH3",
        slug: "nych3",
        region: "New York City, NY",
        sources: [],
        _count: { events: 5 },
      },
      {
        kennelCode: "agnews",
        shortName: "AGNEWS",
        slug: "agnews",
        region: "Atlanta, GA",
        sources: [],
        _count: { events: 3 },
      },
      {
        kennelCode: "philly-h3",
        shortName: "PhillyH3",
        slug: "philly-h3",
        region: "Philadelphia, PA",
        sources: [],
        _count: { events: 4 },
      },
    ] as never);
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "test",
      queueToken: freshToken("nych3"),
    });
    expect(result).toEqual({ ok: true, id: "log_churn" });
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "KENNEL_DEEP_DIVE",
          kennelCode: "nych3",
          findingsCount: 1,
        }),
      }),
    );
  });

  it("rejects an expired token as invalidToken (no row written)", async () => {
    // The page-render-minted token is good for QUEUE_TOKEN_TTL_MS; an
    // idle dashboard whose token aged out before submit must fail
    // closed, not silently no-op. Snapshot + kennel are otherwise
    // valid, so `expired` is the only failing dimension.
    const expiredToken = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: computeQueueSnapshotId(["nych3", "agnews"]),
      expiresAt: Date.now() - 1_000,
    });
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "test",
      queueToken: expiredToken,
    });
    expect(result).toEqual({ ok: false, error: "invalidToken" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("creates an AuditLog row on the happy path (token valid, kennel still in queue, snapshot matches)", async () => {
    mockLogCreate.mockResolvedValue({ id: "log_1" } as never);
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 2,
      summary: "found 2 stale titles",
      queueToken: freshToken("nych3"),
    });
    expect(result).toEqual({ ok: true, id: "log_1" });
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "KENNEL_DEEP_DIVE",
          kennelCode: "nych3",
          findingsCount: 2,
          summary: { note: "found 2 stale titles" },
        }),
      }),
    );
  });

  it("is idempotent: replaying the same valid token returns the existing row without writing a duplicate (#2261 Codex review)", async () => {
    // A KENNEL_DEEP_DIVE row for nych3 already exists at/after this
    // token's mint time — i.e. a prior submit with the same token
    // already succeeded. A retry / double-submit / replayed payload
    // must NOT create a second row (which would corrupt audit history
    // and advance lastDeepDiveAt without a real second review).
    mockLogFindFirst.mockResolvedValue({ id: "log_first" } as never);
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "replayed submit",
      queueToken: freshToken("nych3"),
    });
    expect(result).toEqual({ ok: true, id: "log_first" });
    expect(mockLogCreate).not.toHaveBeenCalled();
    // The dedupe is scoped to this kennel and bounded by the token's
    // mint window (derived from expiresAt − TTL), not "any dive ever".
    expect(mockLogFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "KENNEL_DEEP_DIVE",
          kennelCode: "nych3",
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });
});

describe("recordDeepDiveManual", () => {
  const mockLogCreate = vi.mocked(prisma.auditLog.create);
  const mockKennelFindUnique = vi.mocked(prisma.kennel.findUnique);

  beforeEach(() => {
    mockKennelFindUnique.mockResolvedValue({ shortName: "SFFMH3" } as never);
    mockLogCreate.mockResolvedValue({ id: "log_manual" } as never);
  });

  it("requires admin", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(
      recordDeepDiveManual({
        kennelCode: "sffmh3",
        findingsCount: 1,
        summary: "manual backfill",
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects an empty kennelCode", async () => {
    await expect(
      recordDeepDiveManual({
        kennelCode: "   ",
        findingsCount: 1,
        summary: "manual backfill",
      }),
    ).rejects.toThrow("kennelCode is required");
  });

  it("rejects a negative findings count", async () => {
    await expect(
      recordDeepDiveManual({
        kennelCode: "sffmh3",
        findingsCount: -1,
        summary: "manual backfill",
      }),
    ).rejects.toThrow("findingsCount must be ≥ 0");
  });

  it("fails loud with kennelNotFound when the code doesn't resolve (no row written)", async () => {
    mockKennelFindUnique.mockResolvedValue(null as never);
    const result = await recordDeepDiveManual({
      kennelCode: "does-not-exist",
      findingsCount: 1,
      summary: "manual backfill",
    });
    expect(result).toEqual({ ok: false, error: "kennelNotFound" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("writes a KENNEL_DEEP_DIVE row (marked manual) for the explicit kennel — #2261 SFFMH3 backfill", async () => {
    const result = await recordDeepDiveManual({
      kennelCode: "sffmh3",
      findingsCount: 1,
      summary: "historical FMH3 events backfill (ref #2260)",
    });
    expect(result).toEqual({ ok: true, id: "log_manual", shortName: "SFFMH3" });
    expect(mockKennelFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kennelCode: "sffmh3" } }),
    );
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "KENNEL_DEEP_DIVE",
          kennelCode: "sffmh3",
          findingsCount: 1,
          issuesFiled: 1,
          summary: { note: "historical FMH3 events backfill (ref #2260)", manual: true },
        }),
      }),
    );
  });

  it("trims a padded kennelCode before lookup and write", async () => {
    await recordDeepDiveManual({
      kennelCode: "  sffmh3  ",
      findingsCount: 0,
      summary: "x",
    });
    expect(mockKennelFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kennelCode: "sffmh3" } }),
    );
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kennelCode: "sffmh3" }),
      }),
    );
  });
});

describe("lookupKennelForDeepDive", () => {
  const mockKennelFindUnique = vi.mocked(prisma.kennel.findUnique);

  it("requires admin", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(lookupKennelForDeepDive("sffmh3")).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("returns the kennel identity for the echo confirmation", async () => {
    mockKennelFindUnique.mockResolvedValue({
      kennelCode: "sffmh3",
      shortName: "SFFMH3",
      region: "San Francisco, CA",
    } as never);
    const result = await lookupKennelForDeepDive("  sffmh3 ");
    expect(result).toEqual({
      kennelCode: "sffmh3",
      shortName: "SFFMH3",
      region: "San Francisco, CA",
    });
    expect(mockKennelFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kennelCode: "sffmh3" } }),
    );
  });

  it("returns null for an unknown / empty kennelCode", async () => {
    expect(await lookupKennelForDeepDive("   ")).toBeNull();
    mockKennelFindUnique.mockResolvedValue(null as never);
    expect(await lookupKennelForDeepDive("nope")).toBeNull();
  });
});

describe("getDeepDiveQueueToken", () => {
  const mockKennelFind = vi.mocked(prisma.kennel.findMany);
  const mockLogGroupBy = vi.mocked(prisma.auditLog.groupBy);

  const ORIGINAL_SECRET = process.env.AUDIT_QUEUE_TOKEN_SECRET;
  beforeEach(() => {
    process.env.AUDIT_QUEUE_TOKEN_SECRET = "test-secret-for-queue-tokens";
    mockKennelFind.mockResolvedValue([
      {
        kennelCode: "nych3",
        shortName: "NYCH3",
        slug: "nych3",
        region: "New York City, NY",
        sources: [],
        _count: { events: 5 },
      },
    ] as never);
    mockLogGroupBy.mockResolvedValue([] as never);
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.AUDIT_QUEUE_TOKEN_SECRET;
    } else {
      process.env.AUDIT_QUEUE_TOKEN_SECRET = ORIGINAL_SECRET;
    }
  });

  it("returns a signed token + expiresAt when the kennel is in the queue", async () => {
    const result = await getDeepDiveQueueToken("nych3");
    expect(result).not.toBeNull();
    if (!result) return;
    // Token format is `<base64url>.<hex-mac>` — minimal shape check.
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]+$/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns null when the kennel is not in the current queue", async () => {
    const result = await getDeepDiveQueueToken("not-in-queue");
    expect(result).toBeNull();
  });

  it("returns null for an empty kennelCode (defensive)", async () => {
    expect(await getDeepDiveQueueToken("")).toBeNull();
  });
});

describe("getCloseReasonRatiosByStream", () => {
  const mockGroupBy = vi.mocked(prisma.auditIssue.groupBy);

  it("rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getCloseReasonRatiosByStream()).rejects.toThrow("Unauthorized");
  });

  it("computes the not-planned percentage over known-reason closures only", async () => {
    // 8 closed AUTOMATED, 6 of them not_planned, 2 completed → 75%.
    // No unknown rows, so the known denominator equals closedTotal.
    mockGroupBy.mockResolvedValue([
      { stream: "AUTOMATED", closeReason: "not_planned", _count: { _all: 6 } },
      { stream: "AUTOMATED", closeReason: "completed", _count: { _all: 2 } },
    ] as never);

    const ratios = await getCloseReasonRatiosByStream();
    const automated = ratios.find((r) => r.stream === "AUTOMATED");
    expect(automated).toEqual({
      stream: "AUTOMATED",
      windowDays: 14,
      closedTotal: 8,
      closedNotPlanned: 6,
      closedUnknown: 0,
      notPlannedPct: 75,
    });
  });

  it("returns null pct when the *known* denominator is below the noise floor", async () => {
    // 4 closures total, all not_planned — below RATIO_MIN_DENOMINATOR (5),
    // so pct is null even though the known ratio would be 100%. Prevents
    // tiny samples from showing alarming "100% not-planned" badges.
    mockGroupBy.mockResolvedValue([
      { stream: "CHROME_KENNEL", closeReason: "not_planned", _count: { _all: 4 } },
    ] as never);

    const ratios = await getCloseReasonRatiosByStream();
    const chromeKennel = ratios.find((r) => r.stream === "CHROME_KENNEL");
    expect(chromeKennel).toEqual({
      stream: "CHROME_KENNEL",
      windowDays: 14,
      closedTotal: 4,
      closedNotPlanned: 4,
      closedUnknown: 0,
      notPlannedPct: null,
    });
  });

  it("excludes legacy null closeReason rows from the ratio denominator", async () => {
    // Codex pass-1 finding: counting null rows toward `closedTotal - 0` would
    // bias the metric toward 0% during rollout (lots of legacy null rows
    // dilute the signal). Instead, those are surfaced as `closedUnknown`
    // and excluded from the known denominator so the ratio reflects ONLY
    // closures whose state_reason we actually mirrored. 7 unknown + 3
    // completed = 10 total, but ratio is computed over 3 known → 0%.
    mockGroupBy.mockResolvedValue([
      { stream: "CHROME_EVENT", closeReason: null, _count: { _all: 7 } },
      { stream: "CHROME_EVENT", closeReason: "completed", _count: { _all: 3 } },
    ] as never);

    const ratios = await getCloseReasonRatiosByStream();
    const chromeEvent = ratios.find((r) => r.stream === "CHROME_EVENT");
    expect(chromeEvent).toEqual({
      stream: "CHROME_EVENT",
      windowDays: 14,
      closedTotal: 10,
      closedNotPlanned: 0,
      closedUnknown: 7,
      // Known denominator = 10 - 7 = 3, below RATIO_MIN_DENOMINATOR=5,
      // so we return null rather than a misleading 0% on a tiny sample.
      notPlannedPct: null,
    });
  });

  it("computes the ratio correctly when unknown + known + not_planned coexist", async () => {
    // Mixed row mid-rollout: 5 unknown, 2 not_planned, 6 completed → known
    // denominator = 8, not_planned share = 25%. The 5 unknown rows are
    // surfaced separately so the dashboard can show "5 not yet synced".
    mockGroupBy.mockResolvedValue([
      { stream: "AUTOMATED", closeReason: null, _count: { _all: 5 } },
      { stream: "AUTOMATED", closeReason: "not_planned", _count: { _all: 2 } },
      { stream: "AUTOMATED", closeReason: "completed", _count: { _all: 6 } },
    ] as never);

    const ratios = await getCloseReasonRatiosByStream();
    const automated = ratios.find((r) => r.stream === "AUTOMATED");
    expect(automated).toEqual({
      stream: "AUTOMATED",
      windowDays: 14,
      closedTotal: 13,
      closedNotPlanned: 2,
      closedUnknown: 5,
      notPlannedPct: 25,
    });
  });

  it("returns one row per dashboard stream even when groupBy returned nothing", async () => {
    mockGroupBy.mockResolvedValue([] as never);
    const ratios = await getCloseReasonRatiosByStream();
    // DASHBOARD_STREAMS = AUTOMATED, CHROME_EVENT, CHROME_KENNEL, UNKNOWN
    expect(ratios).toHaveLength(4);
    for (const r of ratios) {
      // windowDays is echoed even on empty streams so the UI never has to
      // fall back to a hardcoded "14d" — Gemini PR #1171 review feedback.
      expect(r.windowDays).toBe(14);
      expect(r.closedTotal).toBe(0);
      expect(r.closedNotPlanned).toBe(0);
      expect(r.closedUnknown).toBe(0);
      expect(r.notPlannedPct).toBeNull();
    }
  });

  it("echoes the explicit days argument as windowDays so the UI stays in sync with the server constant", async () => {
    mockGroupBy.mockResolvedValue([] as never);
    const ratios = await getCloseReasonRatiosByStream(30);
    for (const r of ratios) expect(r.windowDays).toBe(30);
  });
});

describe("getAuditSyncFreshness", () => {
  it("rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(getAuditSyncFreshness()).rejects.toThrow("Unauthorized");
  });

  // Threshold is SYNC_STALENESS_WARN_HOURS = 30 (daily cron + margin).
  // lastSyncAt is derived from real `Date.now()` so the action's own
  // `Date.now()` read lands a few ms later — ageHours is asserted with
  // tolerance rather than faking the clock.
  it.each([
    { label: "recent sync", hoursAgo: 2, stale: false },
    { label: "just inside the threshold", hoursAgo: 29, stale: false },
    { label: "just past the threshold", hoursAgo: 31, stale: true },
    { label: "long-dead sync", hoursAgo: 240, stale: true },
  ])("marks a $label as stale=$stale", async ({ hoursAgo, stale }) => {
    const lastSyncAt = new Date(Date.now() - hoursAgo * 3_600_000);
    mockIssueAggregate.mockResolvedValue(aggregateWithSyncedAt(lastSyncAt));

    const result = await getAuditSyncFreshness();

    expect(result.lastSyncAt).toEqual(lastSyncAt);
    expect(result.stale).toBe(stale);
    expect(result.ageHours).toBeCloseTo(hoursAgo, 1);
  });

  it("treats an empty mirror as stale with a null age", async () => {
    mockIssueAggregate.mockResolvedValue(aggregateWithSyncedAt(null));
    const result = await getAuditSyncFreshness();
    expect(result).toEqual({ lastSyncAt: null, ageHours: null, stale: true });
  });
});

describe("resyncAuditIssues", () => {
  it("rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(resyncAuditIssues()).rejects.toThrow("Unauthorized");
  });

  it("returns ok and revalidates the dashboard on a successful sync", async () => {
    const syncResult: SyncResult = {
      scanned: 5,
      opened: 2,
      closed: 1,
      reopened: 0,
      relabeled: 0,
      delisted: 0,
      errors: [],
    };
    mockSync.mockResolvedValue(syncResult);

    const result = await resyncAuditIssues();

    expect(result).toEqual({ ok: true, result: syncResult });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/audit");
  });

  it("sanitizes a GitHub error (drops the response body) and skips revalidation when the sync throws", async () => {
    // fetchAllAuditIssues embeds GitHub's raw response body in the message;
    // it must not reach the browser verbatim.
    mockSync.mockRejectedValue(
      new Error(
        'GitHub API 401 on page 1: {"message":"Bad credentials","documentation_url":"https://..."}',
      ),
    );

    const result = await resyncAuditIssues();

    expect(result).toEqual({ ok: false, error: "GitHub API 401 on page 1" });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("passes through a non-GitHub error message (capped)", async () => {
    mockSync.mockRejectedValue(new Error("GITHUB_TOKEN not set"));
    const result = await resyncAuditIssues();
    expect(result).toEqual({ ok: false, error: "GITHUB_TOKEN not set" });
  });

  it("flags a partial sync (per-issue errors) without claiming a clean run", async () => {
    const syncResult: SyncResult = {
      scanned: 10,
      opened: 3,
      closed: 1,
      reopened: 0,
      relabeled: 0,
      delisted: 0,
      errors: ["#42: multi-stream label conflict"],
    };
    mockSync.mockResolvedValue(syncResult);

    const result = await resyncAuditIssues();

    // Still ok:true (the sync ran) but errors[] is preserved so the UI can
    // render the amber "partial" state rather than green success.
    expect(result).toEqual({ ok: true, result: syncResult });
    expect(result.ok && result.result.errors).toHaveLength(1);
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/audit");
  });
});
