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

  it("creates without canonical block (and skips dedup tiers) for non-fingerprintable rules", async () => {
    const actions = buildActions();
    const input = { ...BASE_INPUT, ruleSlug: "hare-cta-text" };

    const out = await fileAuditFinding(input, actions);
    expect(out.action).toBe("created");
    // No fingerprint queries at all.
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
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

describe("fileAuditFinding — recurrence escalation", () => {
  /**
   * Wire the strict-tier match such that the post-increment
   * recurrenceCount equals `count`. mockUpdate's return value is what
   * the filer reads as the new count.
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

  /** Vestigial — escalation no longer issues its own findUnique for
   *  kennel info. Kept as a no-op for tests that still wire up
   *  the claim-lost path's `findUnique` for `escalatedToIssueNumber`. */
  function mockKennelLookup() {
    // Intentionally empty: claim-lost path uses its own
    // mockFindUnique.mockResolvedValueOnce within the test body.
  }

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
    mockKennelLookup();
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

  it("rolls back the claim if the meta-issue create fails (no orphan claim, retry-safe)", async () => {
    setupStrictHit(ESCALATION_THRESHOLD);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never); // claim wins
    mockKennelLookup();
    const actions = buildActions({
      createIssue: vi.fn().mockResolvedValue(null), // GitHub create failed
    });

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    // Recur still succeeds (recurrenceCount was already incremented).
    expect(out.escalatedToIssueNumber).toBeUndefined();

    // Strict-tier increment (first mockUpdate call) + rollback
    // (second mockUpdate call) = 2 mockUpdate calls. Rollback now
    // clears BOTH escalation columns to be safe under any
    // post-claim failure (Codex 5c-B pass-1 high finding).
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "ai_base" },
      data: { escalatedAt: null, escalatedToIssueNumber: null },
    });
  });

  it("rolls back the claim if createIssue throws (not just returns null)", async () => {
    // Codex 5c-B pass-1 high finding: previously only the
    // `createIssue → null` branch rolled back. Any thrown rejection
    // (network blip, etc.) leaked the row in a half-escalated state
    // — escalatedAt set, escalatedToIssueNumber null — and every
    // subsequent caller would lose the CAS forever, wedging the
    // base. Now wrapped in try/catch.
    setupStrictHit(ESCALATION_THRESHOLD);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    mockKennelLookup();
    const actions = buildActions({
      createIssue: vi.fn().mockRejectedValue(new Error("network blip")),
    });

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.escalatedToIssueNumber).toBeUndefined();
    // Rollback fired, leaving both escalation columns null so the
    // next call can re-attempt cleanly.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "ai_base" },
      data: { escalatedAt: null, escalatedToIssueNumber: null },
    });
  });

  it("rolls back the claim if the finalize update throws after meta is created", async () => {
    // Codex 5c-B pass-1 high finding: the finalize update at
    // `escalatedToIssueNumber` could fail after meta-issue is filed,
    // producing the same wedge state. Try/catch covers this too.
    setupStrictHit(ESCALATION_THRESHOLD);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    mockKennelLookup();
    // Sequence: strict-tier increment → finalize (throws) → rollback.
    mockUpdate
      .mockResolvedValueOnce({ recurrenceCount: ESCALATION_THRESHOLD } as never) // strict increment
      .mockRejectedValueOnce(new Error("finalize update failed")) // finalize
      .mockResolvedValueOnce({} as never); // rollback
    const actions = buildActions();

    const out = await fileAuditFinding(BASE_INPUT, actions);
    if (out.action !== "recurred") throw new Error("expected recurred");
    expect(out.escalatedToIssueNumber).toBeUndefined();
    // Rollback ran (third mockUpdate call).
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "ai_base" },
      data: { escalatedAt: null, escalatedToIssueNumber: null },
    });
  });

  it("logs but does not surface a link-comment failure (meta still filed + tracked)", async () => {
    setupStrictHit(ESCALATION_THRESHOLD);
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    mockKennelLookup();
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
