import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
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
      count: vi.fn(),
    },
    auditIssue: {
      groupBy: vi.fn(),
    },
  },
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
import { Prisma } from "@/generated/prisma/client";
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
    mockSupCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002" } as never),
    );
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
  const mockKennelFind = vi.mocked(prisma.kennel.findMany);
  const mockLogGroupBy = vi.mocked(prisma.auditLog.groupBy);

  const ORIGINAL_SECRET = process.env.AUDIT_QUEUE_TOKEN_SECRET;
  beforeEach(() => {
    process.env.AUDIT_QUEUE_TOKEN_SECRET = "test-secret-for-queue-tokens";
    // Default queue: a stable list with NYCH3 present so the
    // happy-path test can mint and verify a real token. Tests that
    // exercise removed/changed-snapshot paths override.
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

  it("returns kennelGone when the kennel is no longer in the queue (410-shape)", async () => {
    // Token was minted when NYCH3 was in the queue. Now NYCH3 has
    // been removed (e.g. another admin already marked it complete).
    mockKennelFind.mockResolvedValue([
      {
        kennelCode: "agnews",
        shortName: "AGNEWS",
        slug: "agnews",
        region: "Atlanta, GA",
        sources: [],
        _count: { events: 3 },
      },
    ] as never);
    const result = await recordDeepDive({
      kennelCode: "nych3",
      findingsCount: 1,
      summary: "test",
      queueToken: freshToken("nych3"),
    });
    expect(result).toEqual({ ok: false, error: "kennelGone" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("returns queueChanged when the snapshot diverges (409-shape)", async () => {
    // Token was minted with snapshot of [nych3, agnews], but the
    // queue now also has philly-h3 added. NYCH3 still present, so
    // we want a refresh-and-retry rather than a hard error.
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
    expect(result).toEqual({ ok: false, error: "queueChanged" });
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
