import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    alert: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  resolveAdapterFile,
  buildRelevantFiles,
  buildIssueBody,
  autoFileIssuesForAlerts,
} from "./auto-issue";

const mockAlertFindMany = vi.mocked(prisma.alert.findMany);
const mockAlertFindFirst = vi.mocked(prisma.alert.findFirst);
const mockAlertFindUnique = vi.mocked(prisma.alert.findUnique);
const mockAlertUpdate = vi.mocked(prisma.alert.update);

// ── Shared fixtures ──

/** Build an alert object with sensible defaults and optional overrides. */
function buildAlert(overrides?: Record<string, unknown>) {
  return {
    id: "alert_123",
    type: "STRUCTURE_CHANGE",
    severity: "CRITICAL",
    title: "HTML structure changed",
    sourceId: "src_456",
    context: {
      previousHash: "abc123def456789012345678901234567890",
      currentHash: "xyz789abc123456789012345678901234567890",
    },
    source: {
      name: "hashnyc.com",
      url: "https://hashnyc.com/hareline",
      type: "HTML_SCRAPER",
    },
    ...overrides,
  };
}

// ── Shared mock helpers ──

/** Mock rate-limit and cooldown checks to pass (no limits, no cooldown). */
function setupPassingGuards() {
  mockAlertFindMany.mockResolvedValueOnce([] as never); // isRateLimited → pass
  mockAlertFindFirst.mockResolvedValueOnce(null as never); // isOnCooldown → pass
}

/** Mock fetch: no duplicate issues found, then successful issue creation. */
function mockFetchForIssueCreation(opts?: { issueUrl?: string; issueNumber?: number }) {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy
    .mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        html_url: opts?.issueUrl ?? "https://github.com/test/1",
        number: opts?.issueNumber ?? 1,
      }),
    } as Response);
  return fetchSpy;
}

/** Mock fetch: no duplicate issues found (for dedup-only tests). */
function mockFetchNoDuplicates() {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: async () => [],
  } as Response);
  return fetchSpy;
}

// ── Env save/restore ──

let savedToken: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedToken = process.env.GITHUB_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = savedToken;
  }
});

// ── resolveAdapterFile ──

describe("resolveAdapterFile", () => {
  it("resolves hashnyc.com to the hashnyc adapter", () => {
    expect(resolveAdapterFile("HTML_SCRAPER", "https://hashnyc.com/hareline")).toBe(
      "src/adapters/html-scraper/hashnyc.ts",
    );
  });

  it("resolves BFM website to the bfm adapter", () => {
    expect(resolveAdapterFile("HTML_SCRAPER", "https://benfranklinmob.org")).toBe(
      "src/adapters/html-scraper/bfm.ts",
    );
  });

  it("resolves Google Calendar to the calendar adapter", () => {
    expect(resolveAdapterFile("GOOGLE_CALENDAR", "boston-calendar-id")).toBe(
      "src/adapters/google-calendar/adapter.ts",
    );
  });

  it("resolves Google Sheets to the sheets adapter", () => {
    expect(resolveAdapterFile("GOOGLE_SHEETS", "https://docs.google.com/spreadsheets")).toBe(
      "src/adapters/google-sheets/adapter.ts",
    );
  });

  it("falls back to hashnyc for unrecognized HTML scraper URLs", () => {
    expect(resolveAdapterFile("HTML_SCRAPER", "https://unknown-hash.com")).toBe(
      "src/adapters/html-scraper/hashnyc.ts",
    );
  });

  it("falls back to registry for unknown source types", () => {
    expect(resolveAdapterFile("UNKNOWN_TYPE", "https://example.com")).toBe(
      "src/adapters/registry.ts",
    );
  });

  it("resolves London Hash to the london-hash adapter", () => {
    expect(resolveAdapterFile("HTML_SCRAPER", "https://londonhash.org/runs")).toBe(
      "src/adapters/html-scraper/london-hash.ts",
    );
  });

  it("resolves SLASH to the slash-hash adapter (before generic London)", () => {
    expect(resolveAdapterFile("HTML_SCRAPER", "https://londonhash.org/slah3")).toBe(
      "src/adapters/html-scraper/slash-hash.ts",
    );
  });
});

// ── buildRelevantFiles ──

describe("buildRelevantFiles", () => {
  it("includes adapter file and kennel resolver for UNMATCHED_TAGS", () => {
    const files = buildRelevantFiles("UNMATCHED_TAGS", "HTML_SCRAPER", "https://hashnyc.com");
    expect(files).toContain("src/adapters/html-scraper/hashnyc.ts");
    expect(files).toContain("src/pipeline/kennel-resolver.ts");
    expect(files).toContain("prisma/seed.ts");
  });

  it("includes adapter and structure-hash for STRUCTURE_CHANGE", () => {
    const files = buildRelevantFiles("STRUCTURE_CHANGE", "HTML_SCRAPER", "https://chicagohash.org");
    expect(files).toContain("src/adapters/html-scraper/chicago-hash.ts");
    expect(files).toContain("src/pipeline/structure-hash.ts");
  });

  it("deduplicates files", () => {
    const files = buildRelevantFiles("SCRAPE_FAILURE", "HTML_SCRAPER", "https://hashnyc.com");
    const unique = [...new Set(files)];
    expect(files).toEqual(unique);
  });
});

// ── buildIssueBody ──

describe("buildIssueBody", () => {
  it("includes alert metadata in title", () => {
    const { title } = buildIssueBody(buildAlert());
    expect(title).toBe("[Alert] HTML structure changed — hashnyc.com");
  });

  it("includes claude-fix label", () => {
    const { labels } = buildIssueBody(buildAlert());
    expect(labels).toContain("claude-fix");
    expect(labels).toContain("alert");
    expect(labels).toContain("alert:structure-change");
    expect(labels).toContain("severity:critical");
  });

  it("includes AGENT_CONTEXT block with machine-readable JSON", () => {
    const { body } = buildIssueBody(buildAlert());
    expect(body).toContain("<!-- AGENT_CONTEXT");
    expect(body).toContain('"alertType": "STRUCTURE_CHANGE"');
    expect(body).toContain('"adapterFile": "src/adapters/html-scraper/hashnyc.ts"');
    expect(body).toContain('"testFile": "src/adapters/html-scraper/hashnyc.test.ts"');
  });

  it("includes relevant files section", () => {
    const { body } = buildIssueBody(buildAlert());
    expect(body).toContain("`src/adapters/html-scraper/hashnyc.ts`");
    expect(body).toContain("`src/pipeline/structure-hash.ts`");
  });

  it("includes context section for the alert type", () => {
    const { body } = buildIssueBody(buildAlert());
    expect(body).toContain("### Structure Change");
    expect(body).toContain("Previous hash");
  });

  it("handles UNMATCHED_TAGS with tag list", () => {
    const { body } = buildIssueBody(buildAlert({
      type: "UNMATCHED_TAGS",
      context: { tags: ["NewTag1", "NewTag2"] },
    }));
    expect(body).toContain("`NewTag1`");
    expect(body).toContain("`NewTag2`");
  });

  it("handles SCRAPE_FAILURE with error messages", () => {
    const { body } = buildIssueBody(buildAlert({
      type: "SCRAPE_FAILURE",
      severity: "WARNING",
      context: { errorMessages: ["Network timeout", "ECONNREFUSED"] },
    }));
    expect(body).toContain("Network timeout");
    expect(body).toContain("ECONNREFUSED");
  });

  it("handles UNMATCHED_TAGS with null tags gracefully", () => {
    const { body } = buildIssueBody(buildAlert({
      type: "UNMATCHED_TAGS",
      context: { tags: null },
    }));
    expect(body).toContain("### Unmatched Tags");
  });

  it("handles UNMATCHED_TAGS with missing tags gracefully", () => {
    const { body } = buildIssueBody(buildAlert({
      type: "UNMATCHED_TAGS",
      context: {},
    }));
    expect(body).toContain("### Unmatched Tags");
  });

  it("handles SOURCE_KENNEL_MISMATCH with null tags gracefully", () => {
    const { body } = buildIssueBody(buildAlert({
      type: "SOURCE_KENNEL_MISMATCH",
      context: { tags: null },
    }));
    expect(body).toContain("### Blocked Tags");
  });

  it("escapes --> in context to prevent HTML comment breakout", () => {
    const { body } = buildIssueBody(buildAlert({
      context: {
        previousHash: "abc-->inject",
        currentHash: "xyz-->more",
      },
    }));
    // The AGENT_CONTEXT block should not contain raw -->
    const agentContextMatch = /<!-- AGENT_CONTEXT\n([\s\S]*?)\n-->/.exec(body);
    expect(agentContextMatch).toBeTruthy();
    const agentContextContent = agentContextMatch![1];
    expect(agentContextContent).not.toContain("-->");
    expect(agentContextContent).toContain("--&gt;");
  });
});

// ── autoFileIssuesForAlerts ──

describe("autoFileIssuesForAlerts", () => {
  it("returns early with no alert IDs", async () => {
    const result = await autoFileIssuesForAlerts("src_1", []);
    expect(result).toEqual({ filed: 0, skipped: 0 });
    expect(mockAlertFindMany).not.toHaveBeenCalled();
  });

  it("skips when GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result).toEqual({ filed: 0, skipped: 1 });
  });

  it("skips alerts with ineligible types", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1", type: "UNMATCHED_TAGS" }),
    ] as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });

  it("skips alerts with INFO severity", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1", severity: "INFO" }),
    ] as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });

  it("files a GitHub issue for eligible alerts", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    setupPassingGuards();
    const fetchSpy = mockFetchForIssueCreation();
    mockAlertFindUnique.mockResolvedValueOnce({ repairLog: null } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.filed).toBe(1);
    expect(result.skipped).toBe(0);

    // Verify the issue creation fetch call
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const createCall = fetchSpy.mock.calls[1];
    expect(createCall[0]).toContain("/issues");
    expect((createCall[1] as RequestInit).method).toBe("POST");

    // Verify repairLog was updated with auto_file_issue entry
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert_1" },
        data: expect.objectContaining({
          repairLog: expect.arrayContaining([
            expect.objectContaining({
              action: "auto_file_issue",
              adminId: "system",
              result: "success",
              details: expect.objectContaining({
                issueUrl: "https://github.com/test/1",
                issueNumber: 1,
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it("appends to existing repairLog without overwriting", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    setupPassingGuards();
    mockFetchForIssueCreation({ issueUrl: "https://github.com/test/2", issueNumber: 2 });

    const existingLog = [
      { action: "rescrape", timestamp: "2026-01-01T00:00:00Z", adminId: "admin_1", result: "success" },
    ];
    mockAlertFindUnique.mockResolvedValueOnce({ repairLog: existingLog } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    await autoFileIssuesForAlerts("src_1", ["alert_1"]);

    // Verify the update preserves the existing entry AND adds the new one
    const updateCall = mockAlertUpdate.mock.calls[0];
    const repairLog = (updateCall[0] as { data: { repairLog: unknown[] } }).data.repairLog;
    expect(repairLog).toHaveLength(2);
    expect(repairLog[0]).toEqual(existingLog[0]);
    expect(repairLog[1]).toMatchObject({ action: "auto_file_issue" });
  });

  it("skips when rate limited (3+ issues filed today)", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    // isRateLimited → 3 alerts with auto_file_issue entries today
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    mockAlertFindMany.mockResolvedValueOnce([
      { repairLog: [{ action: "auto_file_issue", timestamp: today.toISOString() }] },
      { repairLog: [{ action: "auto_file_issue", timestamp: today.toISOString() }] },
      { repairLog: [{ action: "auto_file_issue", timestamp: today.toISOString() }] },
    ] as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });

  it("skips when on cooldown (recent auto_file_issue entry)", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    mockAlertFindMany.mockResolvedValueOnce([] as never); // isRateLimited → pass
    mockAlertFindFirst.mockResolvedValueOnce({
      repairLog: [{ action: "auto_file_issue", timestamp: new Date().toISOString() }],
    } as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });

  it("skips when an open issue already exists for the same source", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    setupPassingGuards();

    // hasExistingOpenIssue → returns an issue whose body contains the source ID
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ body: "Some issue body containing src_1 as context" }],
    } as Response);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });

  it("handles GitHub API failure gracefully", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    setupPassingGuards();

    const fetchSpy = mockFetchNoDuplicates();
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.filed).toBe(0);
    expect(result.skipped).toBe(1);

    consoleSpy.mockRestore();
  });

  it("uses GITHUB_REPOSITORY env var for API URL when set", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPOSITORY = "other-org/other-repo";

    mockAlertFindMany.mockResolvedValueOnce([
      buildAlert({ id: "alert_1", sourceId: "src_1" }),
    ] as never);
    setupPassingGuards();
    const fetchSpy = mockFetchForIssueCreation();
    mockAlertFindUnique.mockResolvedValueOnce({ repairLog: null } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    await autoFileIssuesForAlerts("src_1", ["alert_1"]);

    // Verify both API calls used the custom repo
    expect((fetchSpy.mock.calls[0][0] as string)).toContain("other-org/other-repo");
    expect((fetchSpy.mock.calls[1][0] as string)).toContain("other-org/other-repo");

    delete process.env.GITHUB_REPOSITORY;
  });
});
