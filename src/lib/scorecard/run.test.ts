import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn(), automationRun: { findFirst: vi.fn() } } }));

import { prisma } from "@/lib/db";
import type { GhIssue, OpsGithub } from "@/lib/ops-github";

import { runWeeklyScorecard, scorecardMarker } from "./run";

const NOW = new Date("2026-11-30T06:00:05Z");

function fakeGithub(existing: GhIssue[] = []) {
  const createIssue = vi.fn(async () => 3200);
  const github = {
    listIssues: vi.fn(async (q: { labels: string }) => (q.labels === "lane:decision" ? existing : [])),
    listOpenPulls: vi.fn(async () => []),
    branchRuleCount: vi.fn(async () => 0),
    createIssue,
  } as unknown as OpsGithub;
  return { github, createIssue };
}

/** Every unknown-id probe answers 404, as it should once WS1's PR 2 ships. */
const fetch404 = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

describe("runWeeklyScorecard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.automationRun.findFirst).mockResolvedValue(null as never);
  });

  it("files a marked lane:decision issue, emails the owner and returns the table to store", async () => {
    const { github, createIssue } = fakeGithub();
    const email = vi.fn(async () => ({ sent: true as const, id: "em_1" }));

    const { issue, stored } = await runWeeklyScorecard(NOW, { github, gsc: null, fetchImpl: fetch404, email });

    expect(issue).toEqual({ number: 3200, reason: "filed" });
    const created = (createIssue.mock.calls[0] as unknown as [{ title: string; body: string; labels: string[] }])[0];
    expect(created.title).toBe("Checkpoint CP1 — 2026-11-30");
    expect(created.labels).toEqual(["lane:decision"]);
    expect(created.body.startsWith("<!-- scorecard:CP1:2026-11-30 -->")).toBe(true);

    expect(email).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Checkpoint CP1 — 2026-11-30", idempotencyKey: "weekly-scorecard/CP1/2026-11-30" }),
    );
    expect(stored).toMatchObject({ checkpoint: "CP1", preview: false, issueNumber: 3200, emailed: true });
    expect(stored.values.o1_soft404_families).toMatchObject({ v: 0 });
    expect(stored.values.o1_sitemap_read).toMatchObject({ v: null, status: "n/a" });
    expect(stored.values.o10_ruleset_on).toMatchObject({ v: 0, shown: "off" });
    expect(stored.datedChecks).toEqual([
      { id: "cp1_sitemap_read", title: "Google reads the sitemap (GSC sitemap status)", ok: null, detail: "no GSC_SERVICE_ACCOUNT_JSON (owner action A7)" },
    ]);
  });

  it("never files twice: a retry finds its marker and reuses the issue", async () => {
    const marker = scorecardMarker({ checkpoint: "CP1", generatedAt: NOW.toISOString() });
    const prior: GhIssue = {
      number: 3199, title: "", body: `${marker}\n…`, labels: ["lane:decision"],
      createdAt: NOW, closedAt: null, stateReason: null, pull: null,
    };
    const { github, createIssue } = fakeGithub([prior]);
    const { issue } = await runWeeklyScorecard(new Date("2026-11-30T06:20:00Z"), {
      github, gsc: null, fetchImpl: fetch404, email: vi.fn(async () => ({ sent: true as const, id: "x" })),
    });
    expect(issue).toEqual({ number: 3199, reason: "already filed" });
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("reports measures as not available, not a failed run, when sources are missing or down", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("connection terminated"));
    const email = vi.fn(async () => ({ sent: false as const, reason: "email not configured" }));
    const { issue, stored } = await runWeeklyScorecard(NOW, { github: null, gsc: null, fetchImpl: fetch404, email });
    expect(issue).toEqual({ number: null, reason: "no GitHub credential" });
    expect(stored.values.o6_failing_sources).toMatchObject({ v: null, status: "n/a" });
    expect(stored.values.o3_open_defects).toMatchObject({ v: null, status: "n/a" });
    expect(stored.emailed).toBe(false);
  });
});
