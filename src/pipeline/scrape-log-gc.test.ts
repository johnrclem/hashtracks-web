import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  runScrapeLogGc,
  SCRAPE_LOG_KEEP_PER_SOURCE,
  SCRAPE_LOG_GC_BATCH_SIZE,
} from "./scrape-log-gc";

vi.mock("@/lib/db", () => ({
  prisma: { $executeRaw: vi.fn() },
}));

describe("runScrapeLogGc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes in a single batch when fewer than batchSize rows are surplus", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(5 as never);
    const r = await runScrapeLogGc();
    expect(r.deleted).toBe(5);
    expect(r.batches).toBe(1);
    expect(r.keptPerSource).toBe(SCRAPE_LOG_KEEP_PER_SOURCE);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("loops in batches until a short batch signals completion", async () => {
    vi.mocked(prisma.$executeRaw)
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(42 as never);
    const r = await runScrapeLogGc(30, 100);
    expect(r.deleted).toBe(242);
    expect(r.batches).toBe(3);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("stops after a single empty batch", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(0 as never);
    const r = await runScrapeLogGc();
    expect(r.deleted).toBe(0);
    expect(r.batches).toBe(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("keeps the most-recent N per source via a partitioned row_number delete", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(0 as never);
    await runScrapeLogGc();
    const call = vi.mocked(prisma.$executeRaw).mock.calls[0];
    // Tagged-template call shape: [TemplateStringsArray, ...interpolatedValues]
    const sql = (call[0] as unknown as string[]).join("?");
    expect(sql).toContain("row_number()");
    expect(sql).toContain('PARTITION BY "sourceId" ORDER BY "startedAt" DESC');
    expect(sql).toContain("rn >");
    // The two interpolated params are keepPerSource then batchSize.
    expect(call.slice(1)).toEqual([SCRAPE_LOG_KEEP_PER_SOURCE, SCRAPE_LOG_GC_BATCH_SIZE]);
  });
});
