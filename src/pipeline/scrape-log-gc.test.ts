import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runScrapeLogGc, SCRAPE_LOG_KEEP_PER_SOURCE } from "./scrape-log-gc";

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

    const r = await runScrapeLogGc(30, 100);
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

  it("ranks by source via a partitioned row_number query", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
    await runScrapeLogGc();

    const call = vi.mocked(prisma.$queryRaw).mock.calls[0];
    // Tagged-template call shape: [TemplateStringsArray, ...interpolatedValues]
    const sql = (call[0] as unknown as string[]).join("?");
    expect(sql).toContain("row_number()");
    expect(sql).toContain('PARTITION BY "sourceId" ORDER BY "startedAt" DESC');
    expect(sql).toContain("rn >");
    expect(call.slice(1)).toEqual([SCRAPE_LOG_KEEP_PER_SOURCE]);
  });

  it("deletes surplus ids via indexed PK lookups, not a re-ranked query", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(ids(3) as never);
    vi.mocked(prisma.scrapeLog.deleteMany).mockResolvedValueOnce({ count: 3 } as never);

    await runScrapeLogGc();
    expect(prisma.scrapeLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-0", "log-1", "log-2"] } },
    });
  });
});
