import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  // Clear global fetch mock
  vi.restoreAllMocks();
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
  const baseAlert = {
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
  };

  it("includes alert metadata in title", () => {
    const { title } = buildIssueBody(baseAlert);
    expect(title).toBe("[Alert] HTML structure changed — hashnyc.com");
  });

  it("includes claude-fix label", () => {
    const { labels } = buildIssueBody(baseAlert);
    expect(labels).toContain("claude-fix");
    expect(labels).toContain("alert");
    expect(labels).toContain("alert:structure-change");
    expect(labels).toContain("severity:critical");
  });

  it("includes AGENT_CONTEXT block with machine-readable JSON", () => {
    const { body } = buildIssueBody(baseAlert);
    expect(body).toContain("<!-- AGENT_CONTEXT");
    expect(body).toContain('"alertType": "STRUCTURE_CHANGE"');
    expect(body).toContain('"adapterFile": "src/adapters/html-scraper/hashnyc.ts"');
    expect(body).toContain('"testFile": "src/adapters/html-scraper/hashnyc.test.ts"');
  });

  it("includes relevant files section", () => {
    const { body } = buildIssueBody(baseAlert);
    expect(body).toContain("`src/adapters/html-scraper/hashnyc.ts`");
    expect(body).toContain("`src/pipeline/structure-hash.ts`");
  });

  it("includes context section for the alert type", () => {
    const { body } = buildIssueBody(baseAlert);
    expect(body).toContain("### Structure Change");
    expect(body).toContain("Previous hash");
  });

  it("handles UNMATCHED_TAGS with tag list", () => {
    const alert = {
      ...baseAlert,
      type: "UNMATCHED_TAGS",
      context: { tags: ["NewTag1", "NewTag2"] },
    };
    const { body } = buildIssueBody(alert);
    expect(body).toContain("`NewTag1`");
    expect(body).toContain("`NewTag2`");
  });

  it("handles SCRAPE_FAILURE with error messages", () => {
    const alert = {
      ...baseAlert,
      type: "SCRAPE_FAILURE",
      severity: "WARNING",
      context: { errorMessages: ["Network timeout", "ECONNREFUSED"] },
    };
    const { body } = buildIssueBody(alert);
    expect(body).toContain("Network timeout");
    expect(body).toContain("ECONNREFUSED");
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
    const origToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
      expect(result).toEqual({ filed: 0, skipped: 1 });
    } finally {
      if (origToken) process.env.GITHUB_TOKEN = origToken;
    }
  });

  it("skips alerts with ineligible types", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "UNMATCHED_TAGS", // not in AUTO_FILE_ALERT_TYPES
        severity: "WARNING",
        title: "Unmatched tags",
        sourceId: "src_1",
        context: { tags: ["NewTag"] },
        source: { name: "Test Source", url: "https://test.com", type: "HTML_SCRAPER" },
      },
    ] as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });

  it("skips alerts with INFO severity", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    mockAlertFindMany.mockResolvedValueOnce([
      {
        id: "alert_1",
        type: "STRUCTURE_CHANGE",
        severity: "INFO", // not in AUTO_FILE_SEVERITIES
        title: "Structure change",
        sourceId: "src_1",
        context: {},
        source: { name: "Test Source", url: "https://test.com", type: "HTML_SCRAPER" },
      },
    ] as never);

    const result = await autoFileIssuesForAlerts("src_1", ["alert_1"]);
    expect(result.skipped).toBe(1);
    expect(result.filed).toBe(0);
  });
});
