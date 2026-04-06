import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { findMany: vi.fn() },
    auditSuppression: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getAuditTrends,
  getTopOffenders,
  createSuppression,
  deleteSuppression,
  getSuppressionImpact,
} from "./actions";

const mockAdmin = vi.mocked(getAdminUser);
const mockLogFind = vi.mocked(prisma.auditLog.findMany);
const mockSupFind = vi.mocked(prisma.auditSuppression.findMany);
const mockSupCreate = vi.mocked(prisma.auditSuppression.create);
const mockSupDelete = vi.mocked(prisma.auditSuppression.delete);

beforeEach(() => {
  vi.clearAllMocks();
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

  it("calls prisma.delete with the id", async () => {
    mockAdmin.mockResolvedValue({ id: "u_1" } as never);
    mockSupDelete.mockResolvedValue({} as never);
    await deleteSuppression("sup_1");
    expect(mockSupDelete).toHaveBeenCalledWith({ where: { id: "sup_1" } });
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
