import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    auditIssue: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// Stub the registry so buildCanonicalBlock returns a deterministic
// fingerprint without depending on the live rule corpus. The rule
// `hare-url` is registered + fingerprintable; `hare-cta-text` is
// registered but `fingerprint: false` (cross-row). `unknown-rule`
// returns undefined from `getRule`.
vi.mock("@/pipeline/rule-registry", () => ({
  getRule: (slug: string) => {
    if (slug === "hare-url") {
      return { slug: "hare-url", version: 1, fingerprint: true };
    }
    if (slug === "hare-cta-text") {
      return { slug: "hare-cta-text", version: 1, fingerprint: false };
    }
    return undefined;
  },
  semanticHashFor: () => "a".repeat(64),
}));

vi.mock("@/lib/audit-fingerprint", () => ({
  computeAuditFingerprint: ({ ruleSlug }: { ruleSlug: string }) =>
    `fp_${ruleSlug}_dummy`,
}));

import { prisma } from "@/lib/db";
import {
  fileAuditFinding,
  ESCALATION_THRESHOLD,
  type FilerActions,
} from "./audit-filer";
import { AuditStream } from "@/generated/prisma/client";

const mockFindFirst = vi.mocked(prisma.auditIssue.findFirst);
const mockFindUnique = vi.mocked(prisma.auditIssue.findUnique);
const mockFindMany = vi.mocked(prisma.auditIssue.findMany);
const mockUpdate = vi.mocked(prisma.auditIssue.update);
const mockUpdateMany = vi.mocked(prisma.auditIssue.updateMany);

function buildActions(overrides: Partial<FilerActions> = {}): FilerActions {
  return {
    createIssue: vi.fn().mockResolvedValue({
      number: 999,
      htmlUrl: "https://github.com/x/y/issues/999",
    }),
    postComment: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const BASE_INPUT = {
  stream: AuditStream.AUTOMATED,
  kennelCode: "nych3",
  ruleSlug: "hare-url",
  title: "[Audit] NYCH3 — Hare Quality [hare-url] (3 events) — 2026-05-01",
  bodyMarkdown: "## NYCH3 hare-url\n\nDetails here.",
  labels: ["audit", "alert", "audit:automated", "kennel:nych3"],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  // Default findUnique result — supplies kennel info to the
  // post-claim escalation lookup. Tests that exercise the
  // claim-lost path override with `escalatedToIssueNumber: ...`.
  mockFindUnique.mockResolvedValue({
    kennelCode: "nych3",
    kennel: { shortName: "NYCH3" },
  } as never);
});

describe("fileAuditFinding — strict tier", () => {
  it("comments + increments recurrenceCount when an open issue carries the same fingerprint", async () => {
    mockFindFirst.mockResolvedValue({
      id: "ai_1",
      githubNumber: 42,
      htmlUrl: "https://github.com/x/y/issues/42",
      recurrenceCount: 3,
    } as never);
    mockUpdate.mockResolvedValue({ recurrenceCount: 4 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);

    expect(out).toEqual({
      action: "recurred",
      issueNumber: 42,
      htmlUrl: "https://github.com/x/y/issues/42",
      recurrenceCount: 4,
      tier: "strict",
    });
    expect(actions.postComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining("Still recurring on"),
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "ai_1" },
      data: { recurrenceCount: { increment: 1 } },
      select: { recurrenceCount: true },
    });
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("returns error without forking a duplicate when the strict-tier comment fails", async () => {
    mockFindFirst.mockResolvedValue({
      id: "ai_1",
      githubNumber: 42,
      htmlUrl: "https://github.com/x/y/issues/42",
      recurrenceCount: 3,
    } as never);
    const actions = buildActions({
      postComment: vi.fn().mockResolvedValue(false),
    });

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out).toEqual({
      action: "error",
      reason: "comment-failed-strict",
      existingIssueNumber: 42,
    });
    expect(actions.createIssue).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns db-update-failed when the strict-tier increment throws after a successful comment", async () => {
    // Qodo flagged: previously a DB exception after a successful
    // GitHub comment bubbled out of the route as a 500, bypassing
    // the typed FileFindingOutcome and the nonce idempotency cache.
    // A retry would then re-post the comment, double-counting the
    // recurrence. Now: catch and return a typed `db-update-failed`
    // error so the route returns 502 cleanly.
    mockFindFirst.mockResolvedValue({
      id: "ai_1",
      githubNumber: 42,
      htmlUrl: "https://github.com/x/y/issues/42",
      recurrenceCount: 3,
    } as never);
    mockUpdate.mockRejectedValue(new Error("connection lost"));
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out).toEqual({
      action: "error",
      reason: "db-update-failed",
      existingIssueNumber: 42,
    });
    // Comment landed successfully; the DB failure surfaces as the
    // typed outcome rather than an uncaught exception.
    expect(actions.postComment).toHaveBeenCalledTimes(1);
  });
});

describe("fileAuditFinding — bridging tier", () => {
  it("backfills fingerprint + comments when a legacy null-fingerprint row matches kennel + extracted ruleSlug", async () => {
    // No strict match; one legacy candidate with matching slug in title.
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_1",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (2 events) — 2026-04-15",
        recurrenceCount: 0,
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    // Step 3 increment reads back the actual count from the DB.
    mockUpdate.mockResolvedValue({ recurrenceCount: 1 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);

    expect(out).toEqual({
      action: "recurred",
      issueNumber: 17,
      htmlUrl: "https://github.com/x/y/issues/17",
      recurrenceCount: 1,
      tier: "bridging",
    });
    // Step 1: CAS backfills ONLY the fingerprint (no count increment).
    // Splitting the increment out of the CAS prevents count inflation
    // when the comment fails or retries — review feedback from Qodo /
    // CodeRabbit / Codex on PR #1190.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "legacy_1", fingerprint: null },
      data: { fingerprint: "fp_hare-url_dummy" },
    });
    // Step 3: increment runs after comment success, in its own update.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "legacy_1" },
      data: { recurrenceCount: { increment: 1 } },
      select: { recurrenceCount: true },
    });
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("does NOT increment recurrenceCount when bridging comment fails (preserves count integrity on retry)", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_1",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (2 events) — 2026-04-15",
        recurrenceCount: 4,
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    const actions = buildActions({
      postComment: vi.fn().mockResolvedValue(false), // GH comment fails
    });

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out).toEqual({
      action: "error",
      reason: "comment-failed-bridging",
      existingIssueNumber: 17,
    });
    // Critically: the increment update was NEVER called. Backfill
    // (CAS) is in place, but recurrenceCount stays put. A retry will
    // re-attempt the comment + increment cleanly — no count inflation.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("bridges chrome-style `Finding: KENNEL slug` titles too", async () => {
    // Legacy chrome-stream rows from before 5c-C wired the prompts
    // into /api/audit/file-finding don't have the [Audit] bracket
    // format. Bridging now also accepts the chrome-style title
    // format via the secondary extractor (CodeRabbit feedback on
    // PR #1190).
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_chrome",
        githubNumber: 88,
        htmlUrl: "https://github.com/x/y/issues/88",
        title: "Finding: NYCH3 hare-url",
        recurrenceCount: 0,
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    mockUpdate.mockResolvedValue({ recurrenceCount: 1 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out.action).toBe("recurred");
    if (out.action !== "recurred") return;
    expect(out.tier).toBe("bridging");
    expect(out.issueNumber).toBe(88);
  });

  it("skips legacy rows whose title slug does not match", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_other_rule",
        githubNumber: 11,
        htmlUrl: "https://github.com/x/y/issues/11",
        // Different rule slug in brackets — must not bridge.
        title:
          "[Audit] NYCH3 — Title Quality [missing-title] (1 events) — 2026-04-10",
        recurrenceCount: 0,
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 0 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out.action).toBe("created");
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.createIssue).toHaveBeenCalled();
  });

  it("re-checks strict tier on CAS loss to defeat concurrent-bridge double-stamp race", async () => {
    // Race: caller A and caller B both see candidate row 17 as the
    // legacy match. A wins the CAS first, stamps the fingerprint on
    // 17, posts its comment, and returns. B's CAS on 17 returns
    // count=0. WITHOUT the post-CAS strict-tier recheck, B would
    // move to row 18 and double-stamp the fingerprint — producing
    // two open rows for one finding, the very state the dedup
    // system exists to prevent.
    //
    // After the fix, B's CAS-loss path re-runs the strict-tier
    // query, sees that row 17 now carries the target fingerprint,
    // and routes through strict-tier handling.
    // First strict-tier call (top-of-cascade): no match.
    // Second strict-tier call (post-CAS-loss recovery): row 17 is
    // now populated with our fingerprint by the racing caller.
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "legacy_17",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        recurrenceCount: 1,
      } as never);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_17",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (1 events) — 2026-04-15",
        recurrenceCount: 0,
      },
      {
        id: "legacy_18",
        githubNumber: 18,
        htmlUrl: "https://github.com/x/y/issues/18",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (1 events) — 2026-04-12",
        recurrenceCount: 0,
      },
    ] as never);
    // CAS loses on row 17 (race winner already claimed it).
    mockUpdateMany.mockResolvedValue({ count: 0 } as never);
    mockUpdate.mockResolvedValue({ recurrenceCount: 2 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out.action).toBe("recurred");
    if (out.action !== "recurred") return;
    // Routed through strict tier (post-recovery), not bridging.
    expect(out.tier).toBe("strict");
    expect(out.issueNumber).toBe(17);
    // Critically: row 18 was never touched.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("falls through to next candidate when CAS race loses without strict recovery", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_lost_race",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (2 events) — 2026-04-15",
        recurrenceCount: 0,
      },
      {
        id: "legacy_winner",
        githubNumber: 18,
        htmlUrl: "https://github.com/x/y/issues/18",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (1 events) — 2026-04-12",
        recurrenceCount: 0,
      },
    ] as never);
    // First CAS loses (someone else claimed it); second wins.
    mockUpdateMany
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out.action).toBe("recurred");
    if (out.action !== "recurred") return;
    expect(out.issueNumber).toBe(18);
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("returns error after a successful backfill if the bridging comment fails", async () => {
    // Backfill is a permanent mirror improvement — don't roll it
    // back, just surface the error so caller can retry the comment.
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_1",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (2 events) — 2026-04-15",
        recurrenceCount: 0,
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    const actions = buildActions({
      postComment: vi.fn().mockResolvedValue(false),
    });

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out).toEqual({
      action: "error",
      reason: "comment-failed-bridging",
      existingIssueNumber: 17,
    });
    // Backfill stays put.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("falls through to fresh-create when every legacy candidate fails the slug match", async () => {
    // Claude review-feedback gap: cover the full-bridge-no-match path.
    // Multiple null-fingerprint candidates exist for the kennel, but
    // none of them have the target ruleSlug in their title — so
    // bridging exhausts without claiming any row, and the cascade
    // correctly falls through to creating a fresh issue.
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_a",
        githubNumber: 11,
        htmlUrl: "https://github.com/x/y/issues/11",
        // Different rule slug.
        title:
          "[Audit] NYCH3 — Title Quality [missing-title] (1 events) — 2026-04-10",
        recurrenceCount: 0,
      },
      {
        id: "legacy_b",
        githubNumber: 12,
        htmlUrl: "https://github.com/x/y/issues/12",
        // Free-form prose with no recognizable slug — won't match
        // either extractor.
        title: "EWH3 logo missing",
        recurrenceCount: 0,
      },
    ] as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out.action).toBe("created");
    // No CAS attempted (slug mismatches short-circuit the loop).
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.createIssue).toHaveBeenCalled();
  });
});

describe("fileAuditFinding — create tier", () => {
  it("creates a fresh issue with canonical block embedded for fingerprintable rules", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([] as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out).toEqual({
      action: "created",
      issueNumber: 999,
      htmlUrl: "https://github.com/x/y/issues/999",
    });
    const createCall = vi.mocked(actions.createIssue).mock.calls[0][0];
    expect(createCall.body).toContain("<!-- audit-canonical:");
    expect(createCall.body).toContain("fp_hare-url_dummy");
    expect(createCall.title).toBe(BASE_INPUT.title);
    expect(createCall.labels).toEqual(BASE_INPUT.labels);
  });

  it("creates without canonical block (and skips fingerprint dedup tiers) for non-fingerprintable rules when coarse-dedup finds no match", async () => {
    // Non-fingerprintable rules skip the strict + bridging tiers
    // entirely (canonical === null short-circuits both). The coarse
    // tier (#964) runs in their place; with no candidates it falls
    // through to a fresh create.
    mockFindMany.mockResolvedValue([] as never);
    const actions = buildActions();
    const input = { ...BASE_INPUT, ruleSlug: "hare-cta-text" };

    const out = await fileAuditFinding(input, actions);
    expect(out.action).toBe("created");
    // No fingerprint-keyed strict-tier query.
    expect(mockFindFirst).not.toHaveBeenCalled();
    // Coarse-dedup ran (single findMany with stream filter present);
    // no fingerprint:null query without stream filter.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const callArgs = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).toHaveProperty("stream", AuditStream.AUTOMATED);
    const createCall = vi.mocked(actions.createIssue).mock.calls[0][0];
    expect(createCall.body).not.toContain("<!-- audit-canonical:");
  });

  it("creates without canonical block when the rule is not in the registry at all", async () => {
    const actions = buildActions();
    const input = { ...BASE_INPUT, ruleSlug: "totally-unknown-rule" };

    const out = await fileAuditFinding(input, actions);
    expect(out.action).toBe("created");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns create-failed error when the GitHub create call fails", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([] as never);
    const actions = buildActions({
      createIssue: vi.fn().mockResolvedValue(null),
    });

    const out = await fileAuditFinding(BASE_INPUT, actions);
    expect(out).toEqual({ action: "error", reason: "create-failed" });
  });
});

/**
 * Wire the strict-tier match such that the post-increment
 * recurrenceCount equals `count`. mockUpdate's return value is what
 * the filer reads as the new count. Module-scope per Sonar S7721 —
 * nested-function declarations inside describe blocks rebuild on
 * every iteration of `it.each` and trip the lint.
 */
function setupStrictHit(count: number) {
  mockFindFirst.mockResolvedValue({
    id: "ai_base",
    githubNumber: 100,
    htmlUrl: "https://github.com/x/y/issues/100",
    recurrenceCount: count - 1,
    // Kennel info plumbed through `runStrictTier` so `tryEscalate`
    // doesn't need its own findUnique. Tests must include it.
    kennel: { shortName: "NYCH3" },
  } as never);
  mockUpdate.mockResolvedValue({ recurrenceCount: count } as never);
}

describe("fileAuditFinding — recurrence escalation", () => {

  it("does not escalate below the threshold", async () => {
    setupStrictHit(ESCALATION_THRESHOLD - 1);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.escalatedToIssueNumber).toBeUndefined();
    // No claim CAS, no kennel lookup, no second createIssue.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("claim-first → create → finalize when the threshold is crossed", async () => {
    setupStrictHit(ESCALATION_THRESHOLD);
    // Claim CAS wins (count=1). Bridging uses updateMany too, so
    // mockUpdateMany.mockResolvedValueOnce gives us call-order control.
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    const createIssue = vi.fn().mockResolvedValue({
      number: 555,
      htmlUrl: "https://github.com/x/y/issues/555",
    });
    const postComment = vi.fn().mockResolvedValue(true);
    const actions: FilerActions = { createIssue, postComment };

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.escalatedToIssueNumber).toBe(555);

    // Meta-issue was filed with audit:needs-decision label.
    expect(createIssue).toHaveBeenCalledTimes(1);
    const metaCall = createIssue.mock.calls[0][0] as { labels: string[]; title: string };
    expect(metaCall.labels).toContain("audit");
    expect(metaCall.labels).toContain("audit:needs-decision");
    expect(metaCall.labels).toContain("kennel:nych3");
    expect(metaCall.title).toContain("NYCH3");
    expect(metaCall.title).toContain("hare-url");

    // Step 1: atomic claim BEFORE create — this is the race fix.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "ai_base", escalatedAt: null },
      data: { escalatedAt: expect.any(Date) },
    });
    // Step 3: finalize stamps the issue number after create succeeds.
    // (Strict-tier increment is the first mockUpdate call; finalize
    // is the second.)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "ai_base" },
      data: { escalatedToIssueNumber: 555 },
    });

    // Recur comment + escalation link comment = 2 postComment calls.
    expect(postComment).toHaveBeenCalledTimes(2);
    const linkCall = postComment.mock.calls[1];
    expect(linkCall[0]).toBe(100); // base issue
    expect(linkCall[1]).toContain("Escalated to meta-issue #555");
  });

  it("returns the existing meta-issue number when claim CAS loses (already escalated)", async () => {
    setupStrictHit(ESCALATION_THRESHOLD + 3);
    // Claim lost: another caller already escalated.
    mockUpdateMany.mockResolvedValueOnce({ count: 0 } as never);
    // Existing escalation has issue number 333.
    mockFindUnique.mockResolvedValueOnce({
      escalatedToIssueNumber: 333,
    } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.escalatedToIssueNumber).toBe(333);
    // No meta-issue created — winner already filed it.
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  // Rollback paths share the same setup + assertion shape — Codex
  // 5c-B pass-1 surfaced three distinct ways the post-claim block
  // could fail (returns-null create, throwing create, throwing
  // finalize), and each must trigger the same wedge-prevention
  // rollback. Parametrize to keep the assertion logic in one place
  // (Sonar's CPD detector flagged the inline copies as duplicated).
  describe.each([
    {
      label: "createIssue returns null (graceful failure)",
      build: () =>
        buildActions({
          createIssue: vi.fn().mockResolvedValue(null),
        }),
    },
    {
      label: "createIssue throws (network blip / other rejection)",
      build: () =>
        buildActions({
          createIssue: vi.fn().mockRejectedValue(new Error("network blip")),
        }),
    },
  ])("rolls back the claim when $label", ({ build }) => {
    it("clears both escalation columns and surfaces no escalation link", async () => {
      setupStrictHit(ESCALATION_THRESHOLD);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never); // claim wins
      const actions = build();

      const out = await fileAuditFinding(BASE_INPUT, actions);
      if (out.action !== "recurred") throw new Error("expected recurred");
      // Recur succeeds (recurrenceCount was already incremented),
      // but no escalation link surfaces — claim was rolled back.
      expect(out.escalatedToIssueNumber).toBeUndefined();
      // Rollback always clears BOTH columns so the next attempt
      // re-runs the claim CAS cleanly.
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "ai_base" },
        data: { escalatedAt: null, escalatedToIssueNumber: null },
      });
    });
  });

  it("does NOT roll back when finalize update fails after meta-issue is created (preserves linkage to live meta)", async () => {
    // Codex 5c-B PR #1197 P1 finding: the original implementation
    // rolled back on ANY post-claim failure, including when
    // `createIssue` had already succeeded. That produced a real
    // bug — a transient finalize failure would clear `escalatedAt`
    // back to null, and the next recurrence would file a SECOND
    // meta-issue for the same base lifecycle, breaking the
    // one-meta-per-lifecycle invariant.
    //
    // Fix: only rollback for pre-create failures. Post-create
    // failures (finalize throws, link-comment fails) get logged
    // loudly and the column may end up null, but the meta-issue
    // exists in GitHub with `audit:needs-decision` and the
    // escalatedAt claim stays in place so we don't re-file.
    setupStrictHit(ESCALATION_THRESHOLD);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    // Sequence: strict-tier increment → finalize (throws).
    // No rollback expected.
    mockUpdate
      .mockResolvedValueOnce({ recurrenceCount: ESCALATION_THRESHOLD } as never) // strict increment
      .mockRejectedValueOnce(new Error("finalize update failed")); // finalize throws
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    // Meta-issue 999 (from buildActions default) was filed; we
    // surface it even though the column-link write failed.
    expect(out.escalatedToIssueNumber).toBe(999);
    // CRITICALLY: rollback was NOT called. Only 2 mockUpdate calls
    // (strict increment, failed finalize); no third call to clear
    // escalatedAt back to null.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { escalatedAt: null, escalatedToIssueNumber: null },
      }),
    );
  });

  it("skips tryEscalate when the strict-tier row is already escalated (Gemini PR #1197 optimization)", async () => {
    // Optimization: reading `escalatedToIssueNumber` upfront in the
    // strict-tier query lets us short-circuit `tryEscalate` for
    // already-escalated rows. Saves the claim-CAS round-trip on
    // every recur after the first escalation.
    mockFindFirst.mockResolvedValue({
      id: "ai_base",
      githubNumber: 100,
      htmlUrl: "https://github.com/x/y/issues/100",
      recurrenceCount: ESCALATION_THRESHOLD + 4,
      escalatedToIssueNumber: 555, // already escalated
      kennel: { shortName: "NYCH3" },
    } as never);
    mockUpdate.mockResolvedValue({
      recurrenceCount: ESCALATION_THRESHOLD + 5,
    } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.escalatedToIssueNumber).toBe(555);

    // No claim CAS attempted — `tryEscalate` was short-circuited.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    // No meta-issue created.
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("escalates from the bridging tier too when threshold crosses (Codex PR #1197 P2 / Gemini high)", async () => {
    // Bridging only crosses threshold in pathological cases (a
    // legacy row arriving with a high pre-existing recurrenceCount),
    // but the call must be in place for behavioral consistency
    // across both tiers.
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "legacy_high_count",
        githubNumber: 17,
        htmlUrl: "https://github.com/x/y/issues/17",
        title:
          "[Audit] NYCH3 — Hare Quality [hare-url] (1 events) — 2026-04-15",
        recurrenceCount: ESCALATION_THRESHOLD - 1, // count goes to threshold
        escalatedToIssueNumber: null,
        kennel: { shortName: "NYCH3" },
      },
    ] as never);
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 } as never) // bridge backfill
      .mockResolvedValueOnce({ count: 1 } as never); // escalation claim
    mockUpdate.mockResolvedValue({
      recurrenceCount: ESCALATION_THRESHOLD,
    } as never);
    const createIssue = vi.fn().mockResolvedValue({
      number: 777,
      htmlUrl: "https://github.com/x/y/issues/777",
    });
    const postComment = vi.fn().mockResolvedValue(true);
    const actions: FilerActions = { createIssue, postComment };

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.tier).toBe("bridging");
    expect(out.escalatedToIssueNumber).toBe(777);
  });

  it("logs but does not surface a link-comment failure (meta still filed + tracked)", async () => {
    setupStrictHit(ESCALATION_THRESHOLD);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    let postCount = 0;
    const postComment = vi.fn().mockImplementation(async () => {
      postCount += 1;
      // First post (recur comment) ok; second post (escalation link) fails.
      return postCount === 1;
    });
    const actions: FilerActions = {
      createIssue: vi.fn().mockResolvedValue({
        number: 777,
        htmlUrl: "https://github.com/x/y/issues/777",
      }),
      postComment,
    };

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    // Meta is filed and tracked even though link comment failed.
    expect(out.escalatedToIssueNumber).toBe(777);
    expect(postComment).toHaveBeenCalledTimes(2);
  });
});

// ── Coarse-dedup tier (non-fingerprintable rules; #964 / C2H3) ─────────

const COARSE_INPUT = {
  stream: AuditStream.AUTOMATED,
  kennelCode: "c2h3",
  // `hare-cta-text` is registered with `fingerprint: false` in the test
  // mock above — same shape as `event-improbable-time` and the other 4
  // unmigrated rules. canonical block returns null → coarse-dedup runs.
  ruleSlug: "hare-cta-text",
  title: "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-09",
  bodyMarkdown: "## C2H3 hare-cta-text\n\nDetails here.",
  labels: ["audit", "alert", "audit:automated", "kennel:c2h3"],
} as const;

describe("fileAuditFinding — coarse-dedup tier (non-fingerprintable rules)", () => {
  it("comments + CAS-increments recurrenceCount when an open same-stream null-fingerprint row matches kennel + rule", async () => {
    // recurrenceCount 2 keeps us under ESCALATION_THRESHOLD so the
    // escalation path stays out of this test (covered separately).
    mockFindMany.mockResolvedValue([
      {
        id: "coarse_1",
        githubNumber: 964,
        htmlUrl: "https://github.com/x/y/issues/964",
        title:
          "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-08",
        recurrenceCount: 2,
        kennel: { shortName: "C2H3" },
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never); // CAS wins
    const actions = buildActions();

    const out = await fileAuditFinding(COARSE_INPUT, actions);

    expect(out).toEqual({
      action: "recurred",
      issueNumber: 964,
      htmlUrl: "https://github.com/x/y/issues/964",
      recurrenceCount: 3,
      tier: "coarse",
    });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelCode: "c2h3",
          stream: AuditStream.AUTOMATED,
          fingerprint: null,
          state: "open",
          delistedAt: null,
        }),
      }),
    );
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "coarse_1",
        recurrenceCount: 2,
        state: "open",
        delistedAt: null,
      },
      data: { recurrenceCount: { increment: 1 } },
    });
    expect(actions.postComment).toHaveBeenCalledWith(
      964,
      expect.stringContaining("Still recurring on"),
    );
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("escalates after crossing ESCALATION_THRESHOLD on a coarse-dedup recurrence", async () => {
    // Coarse-dedup uses the same escalation path as strict / bridging.
    // When a non-fingerprintable rule has been recurring for
    // ESCALATION_THRESHOLD consecutive cron ticks, the next coarse hit
    // claims the escalation slot and files a meta-issue.
    mockFindMany.mockResolvedValue([
      {
        id: "coarse_1",
        githubNumber: 964,
        htmlUrl: "https://github.com/x/y/issues/964",
        title:
          "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-04",
        recurrenceCount: ESCALATION_THRESHOLD - 1,
        kennel: { shortName: "C2H3" },
      },
    ] as never);
    // First updateMany: coarse CAS wins. Second updateMany: escalation claim.
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.tier).toBe("coarse");
    expect(out.recurrenceCount).toBe(ESCALATION_THRESHOLD);
    expect(out.escalatedToIssueNumber).toBe(999); // default mocked createIssue number
    // Two postComment calls: recurrence comment + escalation link comment.
    expect(actions.postComment).toHaveBeenCalledTimes(2);
  });

  it("does NOT coalesce across audit streams", async () => {
    // chrome-kennel rows for the same kennel + rule must not be
    // attached to by an automated finding (different triage contexts).
    // The mock simulates the DB honoring the stream filter.
    mockFindMany.mockResolvedValue([] as never);
    const actions = buildActions();

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    // Falls through to fresh-create because no same-stream candidate.
    expect(out.action).toBe("created");
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.createIssue).toHaveBeenCalled();
    // The query that actually went out had the stream filter applied.
    const findManyCall = mockFindMany.mock.calls[0][0] as {
      where: { stream: AuditStream };
    };
    expect(findManyCall.where.stream).toBe(AuditStream.AUTOMATED);
  });

  it("on CAS loss after a successful comment, refetches the canonical row and returns the peer's count (single canonical thread)", async () => {
    // Codex round-2 MEDIUM #3 regression. Without refetch-and-return,
    // a CAS loss would either advance to the next candidate (splitting
    // the thread) or retry the CAS (over-counting). After the fix: post
    // comment, lose CAS to a peer, refetch the same row, return peer's
    // count as our outcome.
    const cand = {
      id: "coarse_1",
      githubNumber: 964,
      htmlUrl: "https://github.com/x/y/issues/964",
      title: "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-08",
      recurrenceCount: 2,
      kennel: { shortName: "C2H3" },
    };
    mockFindMany.mockResolvedValue([cand] as never);
    mockUpdateMany.mockResolvedValue({ count: 0 } as never); // CAS loses
    mockFindUnique.mockResolvedValue({
      recurrenceCount: 3,            // peer's increment
      escalatedToIssueNumber: null,
      state: "open",
      delistedAt: null,
    } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    expect(out.action).toBe("recurred");
    if (out.action !== "recurred") return;
    expect(out.issueNumber).toBe(964);
    expect(out.recurrenceCount).toBe(3);            // peer's count, not ours+1
    expect(out.tier).toBe("coarse");
    // Comment posted exactly once (our attempt). CAS attempted once
    // (lost). No create.
    expect(actions.postComment).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("does NOT increment recurrenceCount when the coarse-dedup comment fails (idempotent across cron retries)", async () => {
    // Codex round-3 HIGH #2 regression. Comment-first ordering means a
    // comment failure surfaces before any DB mutation. Next cron tick
    // re-finds the same canonical with the same recurrenceCount and
    // retries cleanly — never over-counting from a partial run.
    const cand = {
      id: "coarse_1",
      githubNumber: 964,
      htmlUrl: "https://github.com/x/y/issues/964",
      title: "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-08",
      recurrenceCount: 2,
      kennel: { shortName: "C2H3" },
    };
    mockFindMany.mockResolvedValue([cand] as never);
    const actions = buildActions({
      postComment: vi.fn().mockResolvedValue(false),
    });

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    expect(out).toEqual({
      action: "error",
      reason: "comment-failed-coarse",
      existingIssueNumber: 964,
    });
    // Critically: NO CAS / DB increment. recurrenceCount is unchanged.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("retries the candidate fetch when the canonical row vanished between findMany and CAS", async () => {
    // Edge case: between candidate fetch and refetch, the canonical row
    // was closed/delisted. The loop tries again from scratch — maybe
    // there's another open candidate.
    const stale = {
      id: "coarse_stale",
      githubNumber: 800,
      htmlUrl: "https://github.com/x/y/issues/800",
      title: "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-04-10",
      recurrenceCount: 5,
      kennel: { shortName: "C2H3" },
    };
    const fresh = {
      id: "coarse_fresh",
      githubNumber: 964,
      htmlUrl: "https://github.com/x/y/issues/964",
      title: "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-08",
      recurrenceCount: 1,
      kennel: { shortName: "C2H3" },
    };
    // Attempt 1: stale row, CAS loses, refetch shows row closed → retry.
    // Attempt 2: fresh row, CAS wins.
    mockFindMany
      .mockResolvedValueOnce([stale] as never)
      .mockResolvedValueOnce([fresh] as never);
    mockUpdateMany
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    mockFindUnique.mockResolvedValueOnce({
      recurrenceCount: 5,
      escalatedToIssueNumber: null,
      state: "closed",      // row was closed
      delistedAt: null,
    } as never);
    const actions = buildActions();

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    expect(out.action).toBe("recurred");
    if (out.action !== "recurred") return;
    expect(out.issueNumber).toBe(964);
    expect(out.recurrenceCount).toBe(2);
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("filters by [<ruleSlug>] in the SQL query for the automated stream", async () => {
    // Without the SQL title filter the 25-row candidate cap could hide
    // the canonical row behind unrelated open audit issues. For automated
    // stream, the [<slug>] bracket is in the title format and gets pushed
    // down to the DB.
    mockFindMany.mockResolvedValue([] as never);
    const actions = buildActions();

    await fileAuditFinding(COARSE_INPUT, actions);
    const callArgs = mockFindMany.mock.calls[0][0] as {
      where: { title?: { contains: string } };
    };
    expect(callArgs.where.title).toEqual({ contains: "[hare-cta-text]" });
  });

  it("filters by trailing ' <ruleSlug>' in the SQL query for chrome streams", async () => {
    // Chrome title format is `Finding: {kennel} {slug}` — slug at end of
    // title. Pushing endsWith into SQL ensures the 25-row cap can't hide
    // the canonical row even if the kennel accumulates many open
    // chrome-stream issues across distinct rules.
    mockFindMany.mockResolvedValue([] as never);
    const actions = buildActions();

    const chromeInput = { ...COARSE_INPUT, stream: AuditStream.CHROME_KENNEL };
    await fileAuditFinding(chromeInput, actions);
    const callArgs = mockFindMany.mock.calls[0][0] as {
      where: { title?: { endsWith: string } };
    };
    expect(callArgs.where.title).toEqual({ endsWith: " hare-cta-text" });
  });

  it("rejects chrome titles whose slug appears amid extra prose (exact-format identity check)", async () => {
    // The chrome title regex is permissive — it captures the LAST slug
    // token. An operator-edited title like `Finding: C2H3 please ignore
    // hare-cta-text` parses as `hare-cta-text` and would be accepted
    // by the SQL endsWith filter. The exact-format in-memory check
    // catches this and forces fall-through to fresh-create.
    mockFindMany.mockResolvedValue([
      {
        id: "chrome_noisy",
        githubNumber: 500,
        htmlUrl: "https://github.com/x/y/issues/500",
        title: "Finding: C2H3 please ignore hare-cta-text",
        recurrenceCount: 0,
        kennel: { shortName: "C2H3" },
      },
    ] as never);
    const actions = buildActions();

    const chromeInput = { ...COARSE_INPUT, stream: AuditStream.CHROME_KENNEL };
    const out = await fileAuditFinding(chromeInput, actions);
    // Strict format mismatch → no canonical match → fresh create.
    expect(out.action).toBe("created");
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.postComment).not.toHaveBeenCalled();
  });

  it("matches chrome titles in the canonical exact format", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "chrome_canon",
        githubNumber: 500,
        htmlUrl: "https://github.com/x/y/issues/500",
        title: "Finding: C2H3 hare-cta-text",
        recurrenceCount: 1,
        kennel: { shortName: "C2H3" },
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    const actions = buildActions();

    const chromeInput = { ...COARSE_INPUT, stream: AuditStream.CHROME_KENNEL };
    const out = await fileAuditFinding(chromeInput, actions);
    expect(out.action).toBe("recurred");
    if (out.action !== "recurred") return;
    expect(out.issueNumber).toBe(500);
    expect(out.tier).toBe("coarse");
  });

  it("returns comment-failed-coarse without rolling back the increment if the recur comment fails", async () => {
    // CAS already incremented; if the comment fails, the count is
    // bumped but no comment landed. A retry will pick a different
    // candidate (recurrenceCount no longer matches the original
    // snapshot). This mirrors strict-tier semantics: comment spam
    // is preferable to a lost recurrence count.
    mockFindMany.mockResolvedValue([
      {
        id: "coarse_1",
        githubNumber: 964,
        htmlUrl: "https://github.com/x/y/issues/964",
        title:
          "[Audit] C2H3 — Hare Quality [hare-cta-text] (1 events) — 2026-05-08",
        recurrenceCount: 7,
        kennel: { shortName: "C2H3" },
      },
    ] as never);
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);
    const actions = buildActions({
      postComment: vi.fn().mockResolvedValue(false),
    });

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    expect(out).toEqual({
      action: "error",
      reason: "comment-failed-coarse",
      existingIssueNumber: 964,
    });
    expect(actions.createIssue).not.toHaveBeenCalled();
  });

  it("skips candidates whose title slug does not match the input rule slug", async () => {
    // Same kennel + stream, but the candidate's title carries a
    // different rule slug. The loop skips it without attempting the
    // CAS, and the cascade falls through to fresh-create.
    mockFindMany.mockResolvedValue([
      {
        id: "coarse_other_rule",
        githubNumber: 99,
        htmlUrl: "https://github.com/x/y/issues/99",
        title:
          "[Audit] C2H3 — Title Quality [title-raw-kennel-code] (1 events) — 2026-05-09",
        recurrenceCount: 0,
        kennel: { shortName: "C2H3" },
      },
    ] as never);
    const actions = buildActions();

    const out = await fileAuditFinding(COARSE_INPUT, actions);
    expect(out.action).toBe("created");
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(actions.createIssue).toHaveBeenCalled();
  });

  it("does NOT run for fingerprintable rules — canonical-non-null routes through strict/bridging only", async () => {
    // Codex review note: coarse-dedup is gated to canonical === null.
    // For a fingerprintable rule (hare-url here), the cascade goes
    // strict → bridging → create; coarse-dedup is never invoked even
    // if the bridging tier exhausts its candidates.
    mockFindFirst.mockResolvedValue(null); // strict miss
    mockFindMany.mockResolvedValue([] as never); // bridging empty
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions); // hare-url (fingerprintable)
    expect(out.action).toBe("created");
    // Bridging fired exactly once with fingerprint:null + kennelCode
    // (no stream filter — bridging accepts cross-stream legacy rows).
    // Coarse-dedup would have been a SECOND findMany call with
    // stream filter — that must not happen.
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const callArgs = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where).not.toHaveProperty("stream");
  });
});
