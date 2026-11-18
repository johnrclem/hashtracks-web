import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn(), automationState: { findMany: vi.fn() } } }));
vi.mock("@/lib/backfill/digest", () => ({ buildBackfillDigest: vi.fn().mockResolvedValue(null), ownerSecondFactors: vi.fn().mockResolvedValue(null) }));

import { prisma } from "@/lib/db";
import type { GhPull, OpsGithub } from "@/lib/ops-github";
import { buildOpsDigest } from "./ops-digest";

const queryRaw = vi.mocked(prisma.$queryRaw);
const findStates = vi.mocked(prisma.automationState.findMany);

function githubWith(pulls: GhPull[] | Error): OpsGithub {
  return {
    listOpenPulls: vi.fn(async () => {
      if (pulls instanceof Error) throw pulls;
      return pulls;
    }),
  } as unknown as OpsGithub;
}

const pull = (n: number, labels: string[], createdAt: string, draft = false): GhPull => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  draft,
  labels,
  createdAt: new Date(createdAt),
  headSha: `sha${n}`,
});

describe("buildOpsDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findStates.mockResolvedValue([] as never);
  });

  it("converts bigint counts and dates into a plain JSON shape", async () => {
    const at = new Date("2026-11-10T14:03:00Z");
    queryRaw
      .mockResolvedValueOnce([{ runs: BigInt(286), failed: BigInt(1), created: BigInt(16), cancelled: BigInt(1) }] as never)
      .mockResolvedValueOnce([
        { name: "Auckland H3 Website", type: "HTML_SCRAPER", startedAt: at, error: "Unparseable run row 2", streak: BigInt(2) },
      ] as never)
      .mockResolvedValueOnce([
        { createdAt: at, type: "SCRAPE_FAILURE", severity: "WARNING", source: "Auckland H3 Website", title: "Scrape failed" },
      ] as never)
      .mockResolvedValueOnce([{ n: BigInt(3) }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ kennelCode: "hogtownh3" }] as never)
      .mockResolvedValueOnce([{ pending: BigInt(52), oldest: at, stale: BigInt(4) }] as never)
      .mockResolvedValueOnce([{ migration_name: "20261113100000_noh3_history_cleanup", started_at: at }] as never);

    const digest = await buildOpsDigest(new Date("2026-11-10T15:00:00Z"), githubWith([]));

    expect(digest.scrapes24h).toEqual({ runs: 286, failed: 1, eventsCreated: 16, eventsCancelled: 1 });
    expect(digest.failingSources).toEqual([
      { name: "Auckland H3 Website", type: "HTML_SCRAPER", lastRunAt: at.toISOString(), error: "Unparseable run row 2", streak: 2 },
    ]);
    expect(digest.openAlerts[0]).toMatchObject({ type: "SCRAPE_FAILURE", source: "Auckland H3 Website" });
    expect(digest.alertsCreated24h).toBe(3);
    expect(digest.largeCancellations24h).toEqual([]);
    expect(digest.allZeroKennels).toEqual(["hogtownh3"]);
    expect(digest.auditQueue).toEqual({ pending: 52, oldestPendingAt: at.toISOString(), stalePending: 4 });
    expect(digest.failedMigrations).toEqual([
      { name: "20261113100000_noh3_history_cleanup", startedAt: at.toISOString() },
    ]);
    expect(JSON.parse(JSON.stringify(digest))).toEqual(digest);
  });

  it("handles empty result sets", async () => {
    queryRaw.mockResolvedValue([] as never);
    const digest = await buildOpsDigest(new Date(), githubWith([]));
    expect(digest.scrapes24h).toEqual({ runs: 0, failed: 0, eventsCreated: 0, eventsCancelled: 0 });
    expect(digest.auditQueue).toEqual({ pending: 0, oldestPendingAt: null, stalePending: 0 });
    expect(digest.alertsCreated24h).toBe(0);
    expect(digest.failedMigrations).toEqual([]);
  });

  it("lists watchdog states, overdue first, then blocked, unknown and OK", async () => {
    queryRaw.mockResolvedValue([] as never);
    const at = new Date("2026-11-17T10:00:00Z");
    const row = (automation: string, status: "OK" | "OVERDUE", verdict: string | null, issueNumber: number | null = null) => ({
      automation,
      status,
      since: at,
      verdict,
      detail: `${automation} detail`,
      checkedAt: at,
      issueNumber,
    });
    findStates.mockResolvedValue([
      row("cron:audit", "OK", "OK"),
      row("deep-dive", "OK", "UNKNOWN"),
      row("hareline-audit", "OVERDUE", "OVERDUE", 3100),
      row("kennel-implementer", "OK", "BLOCKED_ON_OWNER"),
    ] as never);

    const digest = await buildOpsDigest(new Date("2026-11-17T12:00:00Z"), githubWith([]));

    expect(digest.watchdog.map((w) => [w.automation, w.verdict])).toEqual([
      ["hareline-audit", "OVERDUE"],
      ["kennel-implementer", "BLOCKED_ON_OWNER"],
      ["deep-dive", "UNKNOWN"],
      ["cron:audit", "OK"],
    ]);
    expect(digest.watchdog[0]).toMatchObject({
      label: "Hareline audit",
      status: "OVERDUE",
      since: at.toISOString(),
      issueNumber: 3100,
    });
  });

  it("lists PRs waiting on the owner with age and head commit, skipping drafts, approved and handoffs", async () => {
    queryRaw.mockResolvedValue([] as never);
    const github = githubWith([
      pull(2940, ["onboarding-impl"], "2026-11-13T10:10:12Z"),
      pull(2974, ["audit-fix"], "2026-11-13T17:18:43Z"),
      pull(2980, ["audit-fix", "owner-approved"], "2026-11-14T09:00:00Z"),
      pull(2981, ["onboarding-handoff"], "2026-11-15T08:00:00Z"),
      pull(2982, [], "2026-11-16T08:00:00Z", true),
      pull(3046, [], "2026-11-17T09:00:00Z"),
    ]);

    const digest = await buildOpsDigest(new Date("2026-11-17T12:00:00Z"), github);

    expect(digest.approvalsWaiting.error).toBeNull();
    expect(digest.approvalsWaiting.prs?.map((p) => [p.number, p.ageHours, p.headSha])).toEqual([
      [2940, 97, "sha2940"],
      [2974, 90, "sha2974"],
      [3046, 3, "sha3046"],
    ]);
  });

  it("keeps the rest of the digest when GitHub can't be read", async () => {
    queryRaw.mockResolvedValue([] as never);
    const digest = await buildOpsDigest(new Date(), githubWith(new Error("GitHub GET /pulls: HTTP 502")));
    expect(digest.approvalsWaiting).toEqual({ prs: null, error: "GitHub GET /pulls: HTTP 502" });
    expect(digest.scrapes24h.runs).toBe(0);

    const noToken = await buildOpsDigest(new Date(), null);
    expect(noToken.approvalsWaiting).toEqual({ prs: null, error: "GITHUB_TOKEN is not set" });
  });

  it("keeps the rest of the digest when the env-built GitHub client can't be made", async () => {
    queryRaw.mockResolvedValue([] as never);
    vi.stubEnv("GITHUB_TOKEN", "tok");
    vi.stubEnv("GITHUB_REPOSITORY", "not a repo");
    try {
      const digest = await buildOpsDigest(new Date());
      expect(digest.approvalsWaiting).toEqual({ prs: null, error: "Invalid GITHUB_REPOSITORY format: not a repo" });
      expect(digest.scrapes24h.runs).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
