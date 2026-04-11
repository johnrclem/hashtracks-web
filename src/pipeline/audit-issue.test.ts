import { fileAuditIssues } from "./audit-issue";
import type { AuditGroup } from "./audit-runner";

const { mockFindMany, mockAggregate, mockFetch } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockAggregate: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditIssue: { findMany: mockFindMany, aggregate: mockAggregate },
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
