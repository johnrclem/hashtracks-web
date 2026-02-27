// ── Mocks ──

const mockAdmin = { id: "admin_1", clerkId: "clerk_admin" };

vi.mock("@/lib/auth", () => ({
  getAdminUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    alert: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    kennelAlias: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    kennel: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    region: {
      findUnique: vi.fn(),
    },
    sourceKennel: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/pipeline/scrape", () => ({
  scrapeSource: vi.fn(),
}));

vi.mock("@/pipeline/kennel-resolver", () => ({
  resolveKennelTag: vi.fn(),
  clearResolverCache: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scrapeSource } from "@/pipeline/scrape";
import { resolveKennelTag, clearResolverCache } from "@/pipeline/kennel-resolver";
import {
  acknowledgeAlert,
  snoozeAlert,
  resolveAlert,
  resolveAllForSource,
  rescrapeFromAlert,
  createAliasFromAlert,
  createKennelFromAlert,
  linkKennelToSource,
  createIssueFromAlert,
} from "./actions";

const mockAuth = vi.mocked(getAdminUser);
const mockAlertFind = vi.mocked(prisma.alert.findUnique);
const mockAlertUpdate = vi.mocked(prisma.alert.update);
const mockAlertUpdateMany = vi.mocked(prisma.alert.updateMany);
const mockAliasFind = vi.mocked(prisma.kennelAlias.findFirst);
const mockAliasCreate = vi.mocked(prisma.kennelAlias.create);
const mockKennelFind = vi.mocked(prisma.kennel.findUnique);
const mockKennelFindFirst = vi.mocked(prisma.kennel.findFirst);
const mockSourceKennelFind = vi.mocked(prisma.sourceKennel.findUnique);
const mockSourceKennelFindMany = vi.mocked(prisma.sourceKennel.findMany);
const mockSourceKennelCreate = vi.mocked(prisma.sourceKennel.create);
const mockScrape = vi.mocked(scrapeSource);
const mockResolve = vi.mocked(resolveKennelTag);
const mockClearCache = vi.mocked(clearResolverCache);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockRegionFind = vi.mocked(prisma.region.findUnique);

function baseAlert(overrides = {}) {
  return {
    id: "alert_1",
    sourceId: "src_1",
    status: "OPEN",
    type: "UNMATCHED_TAGS",
    title: "Unmatched tags found",
    severity: "WARNING",
    context: { tags: ["NewKennel"] },
    repairLog: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockAdmin as never);
});

// ── acknowledgeAlert ──

describe("acknowledgeAlert", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await acknowledgeAlert("alert_1");
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when alert not found", async () => {
    mockAlertFind.mockResolvedValueOnce(null as never);
    const result = await acknowledgeAlert("alert_1");
    expect(result).toEqual({ error: "Alert not found" });
  });

  it("returns error when alert is not OPEN", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ status: "ACKNOWLEDGED" }) as never);
    const result = await acknowledgeAlert("alert_1");
    expect(result).toEqual({ error: "Alert is not open" });
  });

  it("updates status to ACKNOWLEDGED on success", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await acknowledgeAlert("alert_1");

    expect(result).toEqual({ success: true });
    expect(mockAlertUpdate).toHaveBeenCalledWith({
      where: { id: "alert_1" },
      data: { status: "ACKNOWLEDGED" },
    });
  });
});

// ── snoozeAlert ──

describe("snoozeAlert", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await snoozeAlert("alert_1", 24);
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when alert not found", async () => {
    mockAlertFind.mockResolvedValueOnce(null as never);
    const result = await snoozeAlert("alert_1", 24);
    expect(result).toEqual({ error: "Alert not found" });
  });

  it("returns error when alert already resolved", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ status: "RESOLVED" }) as never);
    const result = await snoozeAlert("alert_1", 24);
    expect(result).toEqual({ error: "Alert is already resolved" });
  });

  it("updates status to SNOOZED with snoozedUntil timestamp", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const before = Date.now();
    const result = await snoozeAlert("alert_1", 24);
    const after = Date.now();

    expect(result).toEqual({ success: true });
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert_1" },
        data: expect.objectContaining({ status: "SNOOZED" }),
      }),
    );

    const snoozedUntil = mockAlertUpdate.mock.calls[0][0].data.snoozedUntil as Date;
    const expectedMin = before + 24 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;
    expect(snoozedUntil.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(snoozedUntil.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});

// ── resolveAlert ──

describe("resolveAlert", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await resolveAlert("alert_1");
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when alert not found", async () => {
    mockAlertFind.mockResolvedValueOnce(null as never);
    const result = await resolveAlert("alert_1");
    expect(result).toEqual({ error: "Alert not found" });
  });

  it("returns error when already resolved", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ status: "RESOLVED" }) as never);
    const result = await resolveAlert("alert_1");
    expect(result).toEqual({ error: "Alert is already resolved" });
  });

  it("updates status to RESOLVED with resolvedAt and resolvedBy", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await resolveAlert("alert_1");

    expect(result).toEqual({ success: true });
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert_1" },
        data: expect.objectContaining({
          status: "RESOLVED",
          resolvedBy: "admin_1",
        }),
      }),
    );
    const data = mockAlertUpdate.mock.calls[0][0].data;
    expect(data.resolvedAt).toBeInstanceOf(Date);
  });
});

// ── resolveAllForSource ──

describe("resolveAllForSource", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await resolveAllForSource("src_1");
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("batch-updates matching alerts to RESOLVED", async () => {
    mockAlertUpdateMany.mockResolvedValueOnce({ count: 3 } as never);

    const result = await resolveAllForSource("src_1");

    expect(result).toEqual({ success: true });
    expect(mockAlertUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceId: "src_1",
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        data: expect.objectContaining({
          status: "RESOLVED",
          resolvedBy: "admin_1",
        }),
      }),
    );
  });
});

// ── rescrapeFromAlert ──

describe("rescrapeFromAlert", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await rescrapeFromAlert("alert_1");
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when alert not found", async () => {
    mockAlertFind.mockResolvedValueOnce(null as never);
    const result = await rescrapeFromAlert("alert_1");
    expect(result).toEqual({ error: "Alert not found" });
  });

  it("appends repair log on success with scrape stats", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockScrape.mockResolvedValueOnce({
      success: true,
      eventsFound: 10,
      created: 3,
      updated: 2,
      errors: [],
    } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await rescrapeFromAlert("alert_1");

    expect(result).toEqual({
      success: true,
      eventsFound: 10,
      created: 3,
      updated: 2,
    });
    expect(mockScrape).toHaveBeenCalledWith("src_1", { force: false });

    const updateCall = mockAlertUpdate.mock.calls[0][0];
    const repairLog = updateCall.data.repairLog as unknown[];
    expect(repairLog).toHaveLength(1);
    expect((repairLog[0] as Record<string, unknown>).action).toBe("rescrape");
    expect((repairLog[0] as Record<string, unknown>).result).toBe("success");
  });

  it("passes force flag through to scrapeSource", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockScrape.mockResolvedValueOnce({
      success: true,
      eventsFound: 5,
      created: 1,
      updated: 0,
      errors: [],
    } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    await rescrapeFromAlert("alert_1", true);

    expect(mockScrape).toHaveBeenCalledWith("src_1", { force: true });
  });
});

// ── createAliasFromAlert ──

describe("createAliasFromAlert", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await createAliasFromAlert("alert_1", "NewTag", "kennel_1", false);
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error for duplicate alias (case-insensitive)", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockAliasFind.mockResolvedValueOnce({ id: "alias_1" } as never);

    const result = await createAliasFromAlert("alert_1", "ExistingTag", "kennel_1", false);
    expect(result).toEqual({ error: `Alias "ExistingTag" already exists` });
  });

  it("creates alias and records repair log", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ context: null }) as never);
    mockAliasFind.mockResolvedValueOnce(null as never);
    mockAliasCreate.mockResolvedValueOnce({} as never);
    mockKennelFind.mockResolvedValueOnce({ shortName: "NYCH3" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await createAliasFromAlert("alert_1", "NewTag", "kennel_1", false);

    expect(result).toEqual({ success: true });
    expect(mockAliasCreate).toHaveBeenCalledWith({
      data: { kennelId: "kennel_1", alias: "NewTag" },
    });
  });

  it("auto-resolves alert when all tags match after alias creation", async () => {
    mockAlertFind.mockResolvedValueOnce(
      baseAlert({ context: { tags: ["NewKennel"] } }) as never,
    );
    mockAliasFind.mockResolvedValueOnce(null as never);
    mockAliasCreate.mockResolvedValueOnce({} as never);
    mockKennelFind.mockResolvedValueOnce({ shortName: "NYCH3" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never); // repair log update
    mockResolve.mockResolvedValueOnce({ matched: true, kennelId: "kennel_1" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never); // auto-resolve update

    const result = await createAliasFromAlert("alert_1", "NewKennel", "kennel_1", false);

    expect(result).toEqual({ success: true });
    // Should have been called twice: repair log + auto-resolve
    expect(mockAlertUpdate).toHaveBeenCalledTimes(2);
    expect(mockAlertUpdate.mock.calls[1][0].data).toEqual(
      expect.objectContaining({ status: "RESOLVED" }),
    );
  });

  it("triggers rescrape when rescrapeAfter=true", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ context: null }) as never);
    mockAliasFind.mockResolvedValueOnce(null as never);
    mockAliasCreate.mockResolvedValueOnce({} as never);
    mockKennelFind.mockResolvedValueOnce({ shortName: "NYCH3" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);
    mockScrape.mockResolvedValueOnce({ success: true } as never);

    await createAliasFromAlert("alert_1", "NewTag", "kennel_1", true);

    expect(mockClearCache).toHaveBeenCalled();
    expect(mockScrape).toHaveBeenCalledWith("src_1");
  });
});

// ── createKennelFromAlert ──

describe("createKennelFromAlert", () => {
  const kennelData = { shortName: "TestH3", fullName: "Test Hash House Harriers", region: "NYC" };

  beforeEach(() => {
    mockRegionFind.mockResolvedValue({ id: "region_1", name: "NYC" } as never);
  });

  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await createKennelFromAlert("alert_1", "TestTag", kennelData, false);
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when kennel already exists", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockKennelFindFirst.mockResolvedValueOnce({ id: "existing_kennel" } as never);

    const result = await createKennelFromAlert("alert_1", "TestTag", kennelData, false);
    expect(result).toEqual({ error: `Kennel "TestH3" already exists` });
  });

  it("creates kennel with correct slug and kennelCode", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ context: null }) as never);
    mockKennelFindFirst
      .mockResolvedValueOnce(null as never) // uniqueness check
      .mockResolvedValueOnce({ id: "new_kennel_1" } as never); // after creation
    mockTransaction.mockResolvedValueOnce([{}] as never);
    mockSourceKennelCreate.mockResolvedValueOnce({} as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await createKennelFromAlert("alert_1", "TestTag", kennelData, false);

    expect(result).toEqual({ success: true });
    expect(mockSourceKennelCreate).toHaveBeenCalledWith({
      data: { sourceId: "src_1", kennelId: "new_kennel_1" },
    });
  });

  it("auto-resolves when all context tags match", async () => {
    mockAlertFind.mockResolvedValueOnce(
      baseAlert({ context: { tags: ["TestTag"] } }) as never,
    );
    mockKennelFindFirst
      .mockResolvedValueOnce(null as never) // uniqueness check
      .mockResolvedValueOnce({ id: "new_kennel_1" } as never); // after creation
    mockTransaction.mockResolvedValueOnce([{}] as never);
    mockSourceKennelCreate.mockResolvedValueOnce({} as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never); // repair log
    mockResolve.mockResolvedValueOnce({ matched: true, kennelId: "new_kennel_1" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never); // auto-resolve

    const result = await createKennelFromAlert("alert_1", "TestTag", kennelData, false);

    expect(result).toEqual({ success: true });
    expect(mockAlertUpdate).toHaveBeenCalledTimes(2);
    expect(mockAlertUpdate.mock.calls[1][0].data).toEqual(
      expect.objectContaining({ status: "RESOLVED" }),
    );
  });
});

// ── linkKennelToSource ──

describe("linkKennelToSource", () => {
  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await linkKennelToSource("alert_1", "NYCH3", false);
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when tag cannot be resolved", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockResolve.mockResolvedValueOnce({ matched: false } as never);

    const result = await linkKennelToSource("alert_1", "BadTag", false);
    expect(result).toEqual({ error: `Cannot resolve "BadTag" to a kennel` });
  });

  it("returns error when link already exists", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert() as never);
    mockResolve.mockResolvedValueOnce({ matched: true, kennelId: "kennel_1" } as never);
    mockSourceKennelFind.mockResolvedValueOnce({ id: "sk_1" } as never);

    const result = await linkKennelToSource("alert_1", "NYCH3", false);
    expect(result).toEqual({ error: "Kennel is already linked to this source" });
  });

  it("creates source-kennel link and records repair log", async () => {
    mockAlertFind.mockResolvedValueOnce(baseAlert({ context: null }) as never);
    mockResolve.mockResolvedValueOnce({ matched: true, kennelId: "kennel_1" } as never);
    mockSourceKennelFind.mockResolvedValueOnce(null as never);
    mockSourceKennelCreate.mockResolvedValueOnce({} as never);
    mockKennelFind.mockResolvedValueOnce({ shortName: "NYCH3" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await linkKennelToSource("alert_1", "NYCH3", false);

    expect(result).toEqual({ success: true, kennelName: "NYCH3" });
    expect(mockSourceKennelCreate).toHaveBeenCalledWith({
      data: { sourceId: "src_1", kennelId: "kennel_1" },
    });
  });

  it("auto-resolves when all blocked tags are linked", async () => {
    mockAlertFind.mockResolvedValueOnce(
      baseAlert({ type: "SOURCE_KENNEL_MISMATCH", context: { tags: ["NYCH3"] } }) as never,
    );
    mockResolve
      .mockResolvedValueOnce({ matched: true, kennelId: "kennel_1" } as never) // initial resolve
      .mockResolvedValueOnce({ matched: true, kennelId: "kennel_1" } as never); // auto-resolve check
    mockSourceKennelFind.mockResolvedValueOnce(null as never);
    mockSourceKennelCreate.mockResolvedValueOnce({} as never);
    mockKennelFind.mockResolvedValueOnce({ shortName: "NYCH3" } as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never); // repair log
    mockSourceKennelFindMany.mockResolvedValueOnce([{ kennelId: "kennel_1" }] as never);
    mockAlertUpdate.mockResolvedValueOnce({} as never); // auto-resolve

    const result = await linkKennelToSource("alert_1", "NYCH3", false);

    expect(result).toEqual({ success: true, kennelName: "NYCH3" });
    expect(mockAlertUpdate).toHaveBeenCalledTimes(2);
    expect(mockAlertUpdate.mock.calls[1][0].data).toEqual(
      expect.objectContaining({ status: "RESOLVED" }),
    );
  });
});

// ── createIssueFromAlert ──

describe("createIssueFromAlert", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, GITHUB_TOKEN: "test-token" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await createIssueFromAlert("alert_1");
    expect(result).toEqual({ error: "Unauthorized" });
  });

  it("returns error when GITHUB_TOKEN not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const result = await createIssueFromAlert("alert_1");
    expect(result).toEqual({ error: "GITHUB_TOKEN not configured" });
  });

  it("returns error when alert not found", async () => {
    mockAlertFind.mockResolvedValueOnce(null as never);
    const result = await createIssueFromAlert("alert_1");
    expect(result).toEqual({ error: "Alert not found" });
  });

  it("creates GitHub issue with correct title and labels", async () => {
    mockAlertFind.mockResolvedValueOnce({
      ...baseAlert(),
      source: { name: "hashnyc.com", url: "https://hashnyc.com", type: "HTML_SCRAPER" },
    } as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ html_url: "https://github.com/test/issues/1", number: 1 }),
        { status: 201 },
      ),
    );
    mockAlertUpdate.mockResolvedValueOnce({} as never);

    const result = await createIssueFromAlert("alert_1");

    expect(result).toEqual({
      success: true,
      issueUrl: "https://github.com/test/issues/1",
    });

    const fetchCall = fetchSpy.mock.calls[0];
    expect(fetchCall[0]).toContain("github.com/repos/johnrclem/hashtracks-web/issues");
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.title).toContain("hashnyc.com");
    expect(body.labels).toContain("alert");
    expect(body.labels).toContain("alert:unmatched-tags");
  });

  it("returns error on GitHub API failure", async () => {
    mockAlertFind.mockResolvedValueOnce({
      ...baseAlert(),
      source: { name: "hashnyc.com", url: "https://hashnyc.com", type: "HTML_SCRAPER" },
    } as never);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Validation Failed", { status: 422 }),
    );

    const result = await createIssueFromAlert("alert_1");
    expect(result.error).toContain("GitHub API 422");
  });
});
