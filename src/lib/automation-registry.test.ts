import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    automationRun: { findFirst: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    auditFindingDraft: { findFirst: vi.fn() },
    scrapeLog: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import type { GhComment, GhIssue, GhPull, OpsGithub } from "@/lib/ops-github";
import { existsSync } from "node:fs";
import path from "node:path";

import { AGENT_CALLS, AUTOMATIONS, CRON_JOBS, fresh, type CheckContext } from "./automation-registry";

const HOUR = 3_600_000;
const NOW = new Date("2026-11-17T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const spec = (id: string) => {
  const found = AUTOMATIONS.find((a) => a.id === id);
  if (!found) throw new Error(`no automation ${id}`);
  return found;
};

const issue = (n: number, o: Partial<GhIssue> = {}): GhIssue => ({
  number: n,
  title: `#${n}`,
  body: "",
  labels: [],
  createdAt: ago(100),
  closedAt: null,
  pull: null,
  ...o,
});
const pr = (n: number, createdAt: Date, mergedAt: Date | null = null) =>
  issue(n, { createdAt, pull: { mergedAt, draft: false } });
const pull = (n: number, labels: string[], draft = false): GhPull => ({
  number: n,
  title: "",
  url: "",
  draft,
  labels,
  createdAt: ago(50),
  headSha: "abc",
});

function github(o: {
  issues?: (q: { labels: string; state: string }) => GhIssue[];
  comments?: GhComment[];
}): OpsGithub {
  return {
    listIssues: vi.fn(async (q) => o.issues?.(q) ?? []),
    listOpenPulls: vi.fn(async () => []),
    listIssueComments: vi.fn(async () => o.comments ?? []),
  } as unknown as OpsGithub;
}

function ctx(o: Partial<CheckContext> & { pulls?: GhPull[] } = {}): CheckContext {
  return {
    now: NOW,
    trackedSince: ago(1000),
    github: null,
    openPulls: async () => o.pulls ?? [],
    ...o,
  };
}

const findRun = vi.mocked(prisma.automationRun.findFirst);

describe("fresh", () => {
  it("is OK while the newest output is within the window", () => {
    expect(fresh("a run", ago(25), 26, ctx())).toEqual({
      what: "a run at least every 26 h",
      ok: true,
      seen: "last one 25 h ago",
    });
    expect(fresh("a run", ago(27), 26, ctx()).ok).toBe(false);
  });

  it("counts a missing output from when tracking began, and a resumed Mac from its recovery", () => {
    expect(fresh("a run", null, 26, ctx({ trackedSince: ago(3) }))).toMatchObject({
      ok: true,
      seen: "none since tracking began 3 h ago",
    });
    expect(fresh("a run", ago(40), 26, ctx({ resumedAt: ago(2) })).ok).toBe(true);
    expect(fresh("a run", ago(40), 26, ctx({ resumedAt: ago(30) })).ok).toBe(false);
  });
});

describe("registry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has unique ids and covers every cron, desktop task and pipeline", () => {
    const ids = AUTOMATIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        ...CRON_JOBS.map((j) => j.id),
        "deep-dive",
        "hareline-audit",
        "ops-digest",
        "audit-fixer",
        "kennel-research",
        "kennel-implementer",
        "scraping",
        "promoter-queue",
        "migrations",
      ]),
    );
  });

  it.each(Object.values(AGENT_CALLS))("%s names a real agent route (rejectUnlessAgent's naming)", (call) => {
    const route = path.join(process.cwd(), "src/app/api/audit/agent", call.slice("agent:".length), "route.ts");
    expect(existsSync(route)).toBe(true);
  });

  it("a cron reads its own latest successful run row", async () => {
    findRun.mockResolvedValue({ startedAt: ago(30) } as never);
    const result = await spec("cron:audit").check(ctx());
    expect(findRun).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automation: { in: ["cron:audit"] }, status: "SUCCESS" } }),
    );
    expect(result.expectations).toEqual([{ what: "a successful run at least every 26 h", ok: false, seen: "last one 30 h ago" }]);
  });

  it("the deep dive needs both an AuditLog row and a submit/discard call", async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue({ createdAt: ago(5) } as never);
    findRun.mockResolvedValue({ startedAt: ago(40) } as never);
    const { expectations } = await spec("deep-dive").check(ctx());
    expect(expectations.map((e) => e.ok)).toEqual([true, false]);
    expect(findRun).toHaveBeenCalledWith(
      expect.objectContaining({ where: { automation: { in: ["agent:submit-finding", "agent:drafts/discard"] }, status: "SUCCESS" } }),
    );
  });

  it("the hareline audit allows 7 days between CHROME_EVENT drafts", async () => {
    findRun.mockResolvedValue({ startedAt: ago(10) } as never);
    vi.mocked(prisma.auditFindingDraft.findFirst).mockResolvedValue({ submittedAt: ago(6 * 24) } as never);
    const { expectations } = await spec("hareline-audit").check(ctx());
    expect(expectations.map((e) => e.ok)).toEqual([true, true]);
  });

  it("scraping needs a ScrapeLog row in the last 2 hours", async () => {
    vi.mocked(prisma.scrapeLog.findFirst).mockResolvedValue({ startedAt: ago(3) } as never);
    expect((await spec("scraping").check(ctx())).expectations[0].ok).toBe(false);
  });

  it("the promoter queue fails on a PENDING draft older than 2 hours", async () => {
    vi.mocked(prisma.auditFindingDraft.findFirst).mockResolvedValue({ submittedAt: ago(2.5) } as never);
    expect((await spec("promoter-queue").check(ctx())).expectations[0]).toMatchObject({
      ok: false,
      seen: "oldest PENDING draft submitted 3 h ago",
    });
    vi.mocked(prisma.auditFindingDraft.findFirst).mockResolvedValue(null);
    expect((await spec("promoter-queue").check(ctx())).expectations[0]).toMatchObject({ ok: true, seen: "queue empty" });
  });

  it("migrations fail on an unfinished, un-rolled-back migration row", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ migration_name: "20261117163940_add_automation_run_state" }] as never);
    const { expectations } = await spec("migrations").check(ctx());
    expect(expectations[0].ok).toBe(false);
    expect(expectations[0].seen).toMatch(/^20261117163940_add_automation_run_state: deploys can't migrate/);
    expect(String(vi.mocked(prisma.$queryRaw).mock.calls[0][0])).toMatch(/started_at < now\(\) - make_interval/);
  });

  it("GitHub-based checks throw without a token (the watchdog records UNKNOWN)", async () => {
    await expect(spec("audit-fixer").check(ctx())).rejects.toThrow(/GITHUB_TOKEN/);
  });

  describe("audit fixer", () => {
    it("counts its PRs, closes and comments on audit issues, not bots, server comments or other issues", async () => {
      const gh = github({
        issues: (q) => {
          if (q.labels === "audit-fix") return [pr(2974, ago(90))];
          if (q.labels === "audit" && q.state === "closed") return [issue(2950, { closedAt: ago(60) })];
          if (q.labels === "audit") return [issue(2901), issue(2950)];
          return [];
        },
        comments: [
          { issueNumber: 2901, createdAt: ago(1), body: "**Still recurring on 2026-11-17.**\n\nbody", byBot: false },
          { issueNumber: 2901, createdAt: ago(1.5), body: "<!-- ops:x -->\nRecovered at …", byBot: false },
          { issueNumber: 2901, createdAt: ago(2), body: "LGTM", byBot: true },
          { issueNumber: 3040, createdAt: ago(3), body: "owner note on a PR", byBot: false },
          { issueNumber: 2901, createdAt: ago(20), body: "Fixed in #2974; checked the live page.", byBot: false },
        ],
      });
      const { expectations, blockedOnOwner } = await spec("audit-fixer").check(ctx({ github: gh }));
      expect(expectations[0]).toMatchObject({ ok: true, seen: "last one 20 h ago" });
      expect(blockedOnOwner).toBeUndefined();
    });

    it("is blocked on the owner once 4 audit-fix PRs wait for approval", async () => {
      const gh = github({});
      const pulls = [
        pull(1, ["audit-fix"]),
        pull(2, ["audit-fix"]),
        pull(3, ["audit-fix"]),
        pull(4, ["audit-fix", "owner-approved"]),
        pull(5, ["audit-fix"], true),
      ];
      expect((await spec("audit-fixer").check(ctx({ github: gh, pulls }))).blockedOnOwner).toBeUndefined();
      pulls.push(pull(6, ["audit-fix"]));
      expect((await spec("audit-fixer").check(ctx({ github: gh, pulls }))).blockedOnOwner).toBe(
        "4 `audit-fix` PRs wait on the owner (#1, #2, #3, #6)",
      );
    });
  });

  it("the implementer counts PRs opened or merged, and is blocked at 2 waiting", async () => {
    const gh = github({ issues: () => [pr(2979, ago(100)), pr(2919, ago(200), ago(30))] });
    const result = await spec("kennel-implementer").check(
      ctx({ github: gh, pulls: [pull(2940, ["onboarding-impl"]), pull(2979, ["onboarding-impl"])] }),
    );
    expect(result.expectations[0]).toMatchObject({ ok: true, seen: "last one 30 h ago" });
    expect(result.blockedOnOwner).toBe("2 `onboarding-impl` PRs wait on the owner (#2940, #2979)");
  });

  it("research counts handoff PRs and is held by an open onboarding-blocked issue", async () => {
    const gh = github({
      issues: (q) => (q.labels === "onboarding-handoff" ? [pr(3020, ago(80))] : [issue(3050)]),
    });
    const result = await spec("kennel-research").check(ctx({ github: gh }));
    expect(result.expectations[0].ok).toBe(false);
    expect(result.blockedOnOwner).toBe("held by onboarding-blocked issue #3050");
  });
});
