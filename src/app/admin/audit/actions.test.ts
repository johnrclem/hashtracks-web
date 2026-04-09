import { describe, it, expect, vi, beforeEach } from "vitest";

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
  recordDeepDive,
} from "./actions";

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

  it("requires admin", async () => {
    mockAdmin.mockResolvedValue(null);
    await expect(
      recordDeepDive({ kennelCode: "X", findingsCount: 1, summary: "test" }),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects empty kennelCode", async () => {
    await expect(
      recordDeepDive({ kennelCode: "", findingsCount: 1, summary: "test" }),
    ).rejects.toThrow("kennelCode is required");
  });

  it("rejects negative findings count", async () => {
    await expect(
      recordDeepDive({ kennelCode: "X", findingsCount: -1, summary: "test" }),
    ).rejects.toThrow("findingsCount must be ≥ 0");
  });

  it("creates an AuditLog row with type=KENNEL_DEEP_DIVE", async () => {
    mockLogCreate.mockResolvedValue({ id: "log_1" } as never);
    const result = await recordDeepDive({
      kennelCode: "NYCH3",
      findingsCount: 2,
      summary: "found 2 stale titles",
    });
    expect(result.id).toBe("log_1");
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "KENNEL_DEEP_DIVE",
          kennelCode: "NYCH3",
          findingsCount: 2,
          summary: { note: "found 2 stale titles" },
        }),
      }),
    );
  });
});
