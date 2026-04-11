import { fileAuditIssues } from "./audit-issue";
import type { AuditGroup } from "./audit-runner";

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditIssue: { findMany: mockFindMany },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

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

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GITHUB_TOKEN = "ghp_test";
  mockFindMany.mockResolvedValue([]);
});

afterEach(() => {
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
    // Should not have called fetch to create an issue
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

  it("returns empty array and does not throw when mirror query fails", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/test/1", number: 1 }),
    });

    // Should fall through with empty existing titles and still create issues
    const result = await fileAuditIssues([buildGroup()]);
    expect(result).toEqual(["https://github.com/test/1"]);
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
