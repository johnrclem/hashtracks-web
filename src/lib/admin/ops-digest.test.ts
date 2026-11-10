import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from "@/lib/db";
import { buildOpsDigest } from "./ops-digest";

const queryRaw = vi.mocked(prisma.$queryRaw);

describe("buildOpsDigest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts bigint counts and dates into a plain JSON shape", async () => {
    const at = new Date("2026-11-10T14:03:00Z");
    queryRaw
      .mockResolvedValueOnce([{ runs: BigInt(286), failed: BigInt(1), created: BigInt(16), cancelled: BigInt(1) }] as never)
      .mockResolvedValueOnce([
        { name: "Auckland H3 Website", type: "HTML_SCRAPER", startedAt: at, error: "Unparseable run row 2", streak: BigInt(2) },
      ] as never)
      .mockResolvedValueOnce([
        { createdAt: at, type: "SCRAPE_FAILURE", severity: "WARNING", source: "Auckland H3 Website", title: "Scrape failed" },
      ] as never)
      .mockResolvedValueOnce([{ n: BigInt(3) }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ kennelCode: "hogtownh3" }] as never)
      .mockResolvedValueOnce([{ pending: BigInt(52), oldest: at }] as never);

    const digest = await buildOpsDigest(new Date("2026-11-10T15:00:00Z"));

    expect(digest.scrapes24h).toEqual({ runs: 286, failed: 1, eventsCreated: 16, eventsCancelled: 1 });
    expect(digest.failingSources).toEqual([
      { name: "Auckland H3 Website", type: "HTML_SCRAPER", lastRunAt: at.toISOString(), error: "Unparseable run row 2", streak: 2 },
    ]);
    expect(digest.openAlerts[0]).toMatchObject({ type: "SCRAPE_FAILURE", source: "Auckland H3 Website" });
    expect(digest.alertsCreated24h).toBe(3);
    expect(digest.largeCancellations24h).toEqual([]);
    expect(digest.allZeroKennels).toEqual(["hogtownh3"]);
    expect(digest.auditQueue).toEqual({ pending: 52, oldestPendingAt: at.toISOString() });
    expect(JSON.parse(JSON.stringify(digest))).toEqual(digest);
  });

  it("handles empty result sets", async () => {
    queryRaw.mockResolvedValue([] as never);
    const digest = await buildOpsDigest();
    expect(digest.scrapes24h).toEqual({ runs: 0, failed: 0, eventsCreated: 0, eventsCancelled: 0 });
    expect(digest.auditQueue).toEqual({ pending: 0, oldestPendingAt: null });
    expect(digest.alertsCreated24h).toBe(0);
  });
});
