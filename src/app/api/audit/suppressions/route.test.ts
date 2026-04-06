import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { auditSuppression: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { GET } from "./route";

const mockFind = vi.mocked(prisma.auditSuppression.findMany);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/audit/suppressions", () => {
  it("returns markdown with no suppressions", async () => {
    mockFind.mockResolvedValue([] as never);
    const res = await GET();
    const body = await res.text();
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("## Active Suppressions");
    expect(body).toContain("*(none currently)*");
  });

  it("renders kennel and global suppressions", async () => {
    mockFind.mockResolvedValue([
      { kennelCode: "NYCH3", rule: "hare-cta-text", reason: "all hares are TBD here", kennel: { shortName: "NYCH3" } },
      { kennelCode: null, rule: "title-html-entities", reason: "rendered correctly downstream", kennel: null },
    ] as never);
    const res = await GET();
    const body = await res.text();
    expect(body).toContain("**NYCH3** (`NYCH3`)");
    expect(body).toContain("hare-cta-text");
    expect(body).toContain("**Global**");
    expect(body).toContain("title-html-entities");
  });
});
