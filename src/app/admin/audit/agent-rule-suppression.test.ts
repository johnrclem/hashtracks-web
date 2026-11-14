/**
 * End to end across the admin action and the promoter: a suppression created
 * for an agent rule slug (one that isn't a built-in audit rule) is accepted,
 * and the promoter then marks that rule's next draft SUPPRESSED instead of
 * filing it. The DB is an in-memory stand-in shared by both sides.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const suppressionRows: { kennelCode: string | null; rule: string }[] = [];

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    auditSuppression: {
      create: vi.fn(async ({ data }: { data: { kennelCode: string | null; rule: string; reason: string; createdBy: string } }) => {
        suppressionRows.push({ kennelCode: data.kennelCode, rule: data.rule });
        return { id: "sup_1", ...data, createdAt: new Date(), kennel: null };
      }),
      findMany: vi.fn(async () => suppressionRows),
    },
    auditFindingDraft: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("@/pipeline/audit-issue-sync", () => ({ syncAuditIssues: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/pipeline/audit-filer", () => ({ fileAuditFinding: vi.fn() }));
vi.mock("@/pipeline/audit-issue", () => ({
  GITHUB_MIN_WRITE_GAP_MS: 1_000,
  buildCronActions: vi.fn(() => ({
    createIssue: vi.fn(),
    postComment: vi.fn(),
    listOpenIssuesByKennel: vi.fn().mockResolvedValue([]),
  })),
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fileAuditFinding } from "@/pipeline/audit-filer";
import { KNOWN_AUDIT_RULES } from "@/pipeline/audit-checks";
import { promoteAuditDrafts } from "@/pipeline/audit-draft-promoter";
import { createSuppression } from "./actions";

const AGENT_RULE = "hares-theme-leak";

beforeEach(() => {
  vi.clearAllMocks();
  suppressionRows.length = 0;
  vi.mocked(getAdminUser).mockResolvedValue({ id: "u_1", email: "a@b.com" } as never);
  vi.mocked(prisma.auditFindingDraft.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.auditFindingDraft.findMany).mockResolvedValue([
    {
      id: "d1",
      stream: "CHROME_EVENT",
      kennelCode: "nych3",
      ruleSlug: AGENT_RULE,
      title: "NYCH3 hares theme leak",
      bodyMarkdown: "body",
      status: "PENDING",
      promoteAttempts: 0,
    },
  ] as never);
});

describe("suppressing an agent rule slug", () => {
  it("is not a built-in rule (the case this test covers)", () => {
    expect((KNOWN_AUDIT_RULES as readonly string[]).includes(AGENT_RULE)).toBe(false);
  });

  it("is accepted and blocks that rule's next draft", async () => {
    await createSuppression({
      kennelCode: "nych3",
      rule: AGENT_RULE,
      reason: "source titles carry the theme on purpose",
    });

    const summary = await promoteAuditDrafts();

    expect(summary.suppressed).toBe(1);
    expect(summary.filed).toBe(0);
    expect(fileAuditFinding).not.toHaveBeenCalled();
    expect(prisma.auditFindingDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUPPRESSED" }) }),
    );
  });
});
