import { fileAuditIssues } from "./audit-issue";
import type { AuditGroup } from "./audit-runner";

const {
  mockFindMany,
  mockAggregate,
  mockFindFirst,
  mockUpdate,
  mockUpdateMany,
  mockFetch,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockAggregate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditIssue: {
      findMany: mockFindMany,
      aggregate: mockAggregate,
      // Used by the shared audit-filer module for fingerprint dedup.
      // Default returns simulate "no existing fingerprint match" so
      // tests fall through to the create path unless a test overrides.
      findFirst: mockFindFirst,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  },
}));

/** Build an {@link AuditGroup} with sensible defaults for testing. */
function buildGroup(overrides: Partial<AuditGroup> = {}): AuditGroup {
  return {
    kennelShortName: "TestH3",
    kennelCode: "testh3",
    rule: "missing-title",
    category: "title",
    severity: "warning",
    adapterType: "HTML_SCRAPER",
    count: 5,
    sampleFindings: [],
    ...overrides,
  };
}

/** Return a fresh syncedAt within the staleness window. */
function freshSyncResult() {
  return { _max: { syncedAt: new Date() } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  process.env.GITHUB_TOKEN = "ghp_test";
  mockAggregate.mockResolvedValue(freshSyncResult());
  mockFindMany.mockResolvedValue([]);
  // Default fingerprint dedup state: no strict match, no bridging
  // candidates. Individual tests override when they need the recur
  // path.
  mockFindFirst.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ recurrenceCount: 0 });
  mockUpdateMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe("fileAuditIssues", () => {
  it("returns empty array when GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await fileAuditIssues([buildGroup()]);
    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("queries AuditIssue mirror for open non-delisted issues", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/test/1", number: 1 }),
    });

    await fileAuditIssues([buildGroup()]);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { state: "open", delistedAt: null },
      select: { title: true },
    });
  });

  it("skips groups whose titles already exist in the mirror", async () => {
    const today = new Date().toISOString().split("T")[0];
    const existingTitle = `[Audit] TestH3 — Title Extraction [missing-title] (5 events) — ${today}`;

    mockFindMany.mockResolvedValue([{ title: existingTitle }]);

    const result = await fileAuditIssues([buildGroup()]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("creates issues for groups not in the mirror", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/test/42", number: 42 }),
    });

    const result = await fileAuditIssues([buildGroup()]);
    expect(result).toEqual(["https://github.com/test/42"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/issues"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("falls back to GitHub API and still creates issues when mirror query fails", async () => {
    mockAggregate.mockRejectedValue(new Error("DB down"));
    mockFetch
      // First call: GitHub API fallback for existing titles
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      // Second call: create issue
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ html_url: "https://github.com/test/1", number: 1 }),
      });

    const result = await fileAuditIssues([buildGroup()]);
    expect(result).toEqual(["https://github.com/test/1"]);
    // First fetch = GH API fallback for titles, second = issue creation
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to GitHub API when mirror is stale", async () => {
    // syncedAt 26 hours ago — beyond the 25h threshold
    const staleDate = new Date(Date.now() - 26 * 60 * 60 * 1000);
    mockAggregate.mockResolvedValue({ _max: { syncedAt: staleDate } });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ html_url: "https://github.com/test/5", number: 5 }),
      });

    const result = await fileAuditIssues([buildGroup()]);
    expect(result).toEqual(["https://github.com/test/5"]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("embeds the canonical block for fingerprintable rules", async () => {
    // `hare-url` is registered in rule-definitions.ts as fingerprint:true,
    // so cron-filed issues must carry the audit-canonical block. The sync
    // pipeline reads the block on next upsert and populates
    // AuditIssue.fingerprint without re-deriving the hash.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/test/1", number: 1 }),
    });

    await fileAuditIssues([buildGroup({ rule: "hare-url", category: "hares" })]);

    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body) as { body: string };
    expect(requestBody.body).toContain("<!-- audit-canonical:");
    expect(requestBody.body).toContain('"stream":"AUTOMATED"');
    expect(requestBody.body).toContain('"ruleSlug":"hare-url"');
    expect(requestBody.body).toContain('"kennelCode":"testh3"');
  });

  it("omits the canonical block for non-fingerprintable rules", async () => {
    // Imperative-only rules (hare-cta-text, title-raw-kennel-code, etc.)
    // aren't in the registry — issues for them stay un-fingerprinted.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/test/2", number: 2 }),
    });

    await fileAuditIssues([buildGroup({ rule: "hare-cta-text", category: "hares" })]);

    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body) as { body: string };
    expect(requestBody.body).not.toContain("<!-- audit-canonical:");
  });

  it("comments instead of forking a duplicate when the same fingerprint already has an open issue", async () => {
    // Cross-day recur defense — root P0 of the audit-process plan.
    // Yesterday's open issue with matching fingerprint absorbs today's
    // finding via a "Still recurring …" comment + recurrenceCount++.
    mockFindFirst.mockResolvedValue({
      id: "ai_existing",
      githubNumber: 42,
      htmlUrl: "https://github.com/test/42",
      recurrenceCount: 1,
    });
    mockUpdate.mockResolvedValue({ recurrenceCount: 2 });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await fileAuditIssues([
      buildGroup({ rule: "hare-url", category: "hares" }),
    ]);

    expect(result).toEqual(["https://github.com/test/42"]);
    // Only one fetch — the comment. NO POST to /issues.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain("/issues/42/comments");
    // recurrenceCount was incremented atomically.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "ai_existing" },
      data: { recurrenceCount: { increment: 1 } },
      select: { recurrenceCount: true },
    });
  });

  it("bridges into a legacy null-fingerprint row when kennel + extracted ruleSlug match", async () => {
    // No strict match; one legacy candidate with the matching slug
    // bracket in its title. Filer should atomically backfill the
    // fingerprint and post the recur comment.
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockImplementation((args: { where?: { fingerprint?: null } }) => {
      // The audit-filer's bridging query has `fingerprint: null` in the
      // where clause; the same-run-dedup query doesn't. Branch on it.
      if (args.where?.fingerprint === null) {
        return Promise.resolve([
          {
            id: "legacy_1",
            githubNumber: 17,
            htmlUrl: "https://github.com/test/17",
            title:
              "[Audit] TestH3 — Hare Quality [hare-url] (2 events) — 2026-04-15",
            recurrenceCount: 0,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await fileAuditIssues([
      buildGroup({ rule: "hare-url", category: "hares" }),
    ]);

    expect(result).toEqual(["https://github.com/test/17"]);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "legacy_1", fingerprint: null },
      }),
    );
    // Fetch was the bridging comment, not a fresh-create POST.
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain("/issues/17/comments");
  });

  it("caps issues at MAX_ISSUES_PER_RUN (3)", async () => {
    let issueNum = 1;
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ html_url: `https://github.com/test/${issueNum}`, number: issueNum++ }),
    }));

    const groups = Array.from({ length: 5 }, (_, i) =>
      buildGroup({ kennelCode: `k${i}`, kennelShortName: `K${i}H3` }),
    );

    const result = await fileAuditIssues(groups);
    expect(result).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
