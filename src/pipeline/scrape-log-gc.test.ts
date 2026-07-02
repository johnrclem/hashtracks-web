import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  runScrapeLogGc,
  SCRAPE_LOG_KEEP_PER_SOURCE,
  SCRAPE_LOG_KEEP_SUCCESS_PER_SOURCE,
} from "./scrape-log-gc";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    scrapeLog: { deleteMany: vi.fn() },
  },
}));

function ids(n: number): Array<{ id: string }> {
  return Array.from({ length: n }, (_, i) => ({ id: `log-${i}` }));
}

describe("runScrapeLogGc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes in a single batch when fewer than batchSize rows are surplus", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(ids(5) as never);
    vi.mocked(prisma.scrapeLog.deleteMany).mockResolvedValueOnce({ count: 5 } as never);

    const r = await runScrapeLogGc();
    expect(r.deleted).toBe(5);
    expect(r.batches).toBe(1);
    expect(r.keptPerSource).toBe(SCRAPE_LOG_KEEP_PER_SOURCE);
    expect(r.keptSuccessPerSource).toBe(SCRAPE_LOG_KEEP_SUCCESS_PER_SOURCE);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.scrapeLog.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("ranks the surplus set ONCE regardless of how many delete batches follow", async () => {
    // 242 surplus rows at batchSize=100 → 3 delete batches, but the ranking
    // query (the expensive full-table sort) must run exactly once.
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(ids(242) as never);
    vi.mocked(prisma.scrapeLog.deleteMany)
      .mockResolvedValueOnce({ count: 100 } as never)
      .mockResolvedValueOnce({ count: 100 } as never)
      .mockResolvedValueOnce({ count: 42 } as never);

    const r = await runScrapeLogGc(30, 10, 100);
    expect(r.deleted).toBe(242);
    expect(r.batches).toBe(3);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.scrapeLog.deleteMany).toHaveBeenCalledTimes(3);
  });

  it("does nothing when there is no surplus", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);

    const r = await runScrapeLogGc();
    expect(r.deleted).toBe(0);
    expect(r.batches).toBe(0);
    expect(prisma.scrapeLog.deleteMany).not.toHaveBeenCalled();
  });

  it("ranks by source (any status) AND by source+SUCCESS via two window functions", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
    await runScrapeLogGc();

    const call = vi.mocked(prisma.$queryRaw).mock.calls[0];
    // Tagged-template call shape: [TemplateStringsArray, ...interpolatedValues]
    const sql = (call[0] as unknown as string[]).join("?");
    expect(sql).toContain("row_number()");
    expect(sql).toContain('PARTITION BY "sourceId" ORDER BY "startedAt" DESC');
    expect(sql).toContain('PARTITION BY "sourceId", ("status" = \'SUCCESS\')');
    expect(sql).toContain("overall_rn >");
    expect(sql).toContain("status_rn >");
    // The two interpolated params are keepPerSource then keepSuccessPerSource.
    expect(call.slice(1)).toEqual([SCRAPE_LOG_KEEP_PER_SOURCE, SCRAPE_LOG_KEEP_SUCCESS_PER_SOURCE]);
  });

  it("deletes surplus ids via indexed PK lookups, not a re-ranked query", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(ids(3) as never);
    vi.mocked(prisma.scrapeLog.deleteMany).mockResolvedValueOnce({ count: 3 } as never);

    await runScrapeLogGc();
    expect(prisma.scrapeLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-0", "log-1", "log-2"] } },
    });
  });

  // Regression test for the scenario found in review on PR #2529: a source
  // with a long outage (many consecutive non-SUCCESS scrapes since its last
  // SUCCESS) must not have its SUCCESS history wiped by the overall quota
  // alone — health.ts's baseline would go empty and silently stop detecting
  // regressions / auto-resolve stale trend alerts. The predicate shape below
  // was manually verified against a real Postgres instance (synthetic
  // ScrapeLog rows: 1 SUCCESS + 35 FAILED for one source) — the SUCCESS row
  // survives despite an overall rank of 36 because its status-specific rank
  // is 1. This unit test pins that predicate shape (AND of two independent
  // conditions) so a future edit can't silently collapse it back to a single
  // combined rank.
  it("protects SUCCESS rows via a status-specific quota independent of the overall quota", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
    await runScrapeLogGc();

    const call = vi.mocked(prisma.$queryRaw).mock.calls[0];
    const sql = (call[0] as unknown as string[]).join("?");
    // A row is surplus only when it fails BOTH the overall AND the
    // status-specific check — i.e. an AND of two independent conditions, not
    // a single combined rank.
    expect(sql).toMatch(/overall_rn > [\s\S]*AND[\s\S]*\([\s\S]*status <> 'SUCCESS'[\s\S]*OR[\s\S]*status_rn > [\s\S]*\)/);
  });
});
