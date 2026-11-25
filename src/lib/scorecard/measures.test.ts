import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import type { GhIssue, GhPull, OpsGithub } from "@/lib/ops-github";

import { isAgentOrWorkstreamPr } from "@/lib/ops-github";

import { githubMeasures, soft404Measure } from "./measures";

const NOW = new Date("2026-11-30T06:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const issue = (n: number, o: Partial<GhIssue> = {}): GhIssue => ({
  number: n, title: "", body: "", labels: [], createdAt: ago(500), closedAt: null, stateReason: null, pull: null, ...o,
});
const pull = (n: number, o: Partial<GhPull> = {}): GhPull => ({
  number: n, title: "", url: "", draft: false, labels: [], createdAt: ago(10), headSha: "s",
  headRef: "main-fix", author: "johnrclem", authorIsBot: false, ...o,
});

describe("isAgentOrWorkstreamPr", () => {
  it("counts bot authors, agent and session branches and agent labels; not the owner's own PRs", () => {
    expect(isAgentOrWorkstreamPr(pull(1, { authorIsBot: true }))).toBe(true);
    expect(isAgentOrWorkstreamPr(pull(2, { headRef: "claude/ws10-weekly-scorecard" }))).toBe(true);
    expect(isAgentOrWorkstreamPr(pull(3, { headRef: "audit-fix/hc-cluster" }))).toBe(true);
    expect(isAgentOrWorkstreamPr(pull(4, { labels: ["onboarding-impl"] }))).toBe(true);
    expect(isAgentOrWorkstreamPr(pull(5, { headRef: "fix-typo" }))).toBe(false);
  });
});

describe("githubMeasures", () => {
  it("computes defect flow, the owner queue, handoff merging and agent merges", async () => {
    const github = {
      listIssues: vi.fn(async (q: { labels: string; state: string }) => {
        // One read of every defect updated this week: this week's closes and opens, plus older ones.
        if (q.labels === "lane:defect" && q.state === "all")
          return [
            issue(1, { closedAt: ago(10), stateReason: "completed" }),
            issue(2, { closedAt: ago(20), stateReason: "completed" }),
            issue(3, { closedAt: ago(30), stateReason: "not_planned" }),
            issue(4, { closedAt: ago(300), stateReason: "completed" }),
            issue(5, { createdAt: ago(5) }),
            issue(6, { createdAt: ago(400) }),
          ];
        if (q.labels === "lane:defect") return [issue(7), issue(8), issue(9, { pull: { mergedAt: null, draft: false } })];
        if (q.labels === "onboarding-handoff")
          return [
            issue(3067, { createdAt: ago(260), pull: { mergedAt: null, draft: false } }),
            issue(3030, { createdAt: ago(200), pull: { mergedAt: ago(199), draft: false } }),
            issue(3110, { createdAt: ago(5), pull: { mergedAt: null, draft: false } }),
          ];
        if (q.labels === "audit-fix") return [issue(2974, { pull: { mergedAt: ago(30), draft: false } })];
        return [];
      }),
      listOpenPulls: vi.fn(async () => [
        pull(2974, { labels: ["audit-fix"], createdAt: ago(300) }),
        pull(3150, { headRef: "claude/ws1", createdAt: ago(20) }),
        pull(1026, { createdAt: ago(5000) }),
        pull(3151, { headRef: "claude/x", labels: ["owner-approved"] }),
      ]),
      branchRuleCount: vi.fn(async () => 3),
    } as unknown as OpsGithub;

    const v = await githubMeasures(github, NOW);
    expect(v.o3_defects_closed_week).toMatchObject({ value: 2, note: "3 closed in all" });
    expect(v.o3_not_planned_share).toMatchObject({ value: 33, display: "33% (1/3)" });
    expect(v.o3_defects_opened_week.value).toBe(1);
    expect(v.o3_open_defects.value).toBe(2);
    expect(v.o4_waiting_prs).toEqual({ value: 2, display: "2 (#2974, #3150)" });
    expect(v.o4_oldest_waiting_h).toEqual({ value: 300, display: "300 h (#2974)" });
    expect(v.o4_handoffs_self_merged).toEqual({ value: 50, display: "50% (1/2)" });
    expect(v.o5_agent_prs_merged_week).toEqual({ value: 1, display: "1 (#2974)" });
    expect(v.o10_ruleset_on).toEqual({ value: 3, display: "on (3 rules)" });
  });

  it("reports every GitHub measure as not available without a credential", async () => {
    const v = await githubMeasures(null, NOW);
    expect(v.o4_waiting_prs).toMatchObject({ value: null });
  });
});

describe("soft404Measure", () => {
  it("counts route families that answer an unknown id with 200", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new Response("", { status: url.includes("/hareline/") ? 404 : 200 }),
    ) as unknown as typeof fetch;
    const v = await soft404Measure(fetchImpl);
    expect(v.o1_soft404_families).toEqual({ value: 2, note: "/kennels 200, /kennels/region 200, /hareline 404" });
  });
});
