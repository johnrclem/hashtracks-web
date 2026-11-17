import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    backfillRun: { findMany: vi.fn() },
    scrapeLog: { findMany: vi.fn() },
    cronHeartbeat: { findUnique: vi.fn() },
  },
}));
vi.mock("./watch", () => ({ WATCH_JOB: "backfill-watch" }));

import { prisma } from "@/lib/db";
import { buildBackfillDigest } from "./digest";

const NOW = new Date("2026-11-20T12:00:00Z");

describe("backfills digest block (11.2)", () => {
  it("lists what needs the owner, leak flags, drops per kennel, status-line changes and a stale watch", async () => {
    vi.mocked(prisma.backfillRun.findMany)
      .mockResolvedValueOnce([
        { id: "r1", prNumber: 1, status: "VERIFIED", counts: { rows: 3 }, reasonCodes: [], statusLines: { before: { line: "Last run we saw: 3 Nov" }, after: { line: "Last run we saw: 3 Nov" } } },
        { id: "r2", prNumber: 2, status: "APPLIED", counts: {}, reasonCodes: [], statusLines: { before: { line: "We haven't seen a run" }, after: { line: "Last run we saw: 1 Mar" } } },
        { id: "r3", prNumber: 3, status: "BLOCKED", counts: {}, reasonCodes: ["G8: the archive contains phone numbers or email addresses"], statusLines: null },
      ] as never)
      .mockResolvedValueOnce([
        { id: "r3", prNumber: 3, status: "BLOCKED", reasonCodes: ["G8: the archive contains phone numbers or email addresses"], leaseExpiresAt: null },
        { id: "r4", prNumber: 4, status: "APPLYING", reasonCodes: [], leaseExpiresAt: new Date("2026-11-20T09:00:00Z") },
      ] as never);
    vi.mocked(prisma.scrapeLog.findMany).mockResolvedValue([
      { diagnosticContext: { archiveCutoff: { byKennel: { k1: { cutoff: 2, correction: 0 } } } } },
      { diagnosticContext: { archiveCutoff: { byKennel: { k1: { cutoff: 1, correction: 1 } } } } },
    ] as never);
    vi.mocked(prisma.cronHeartbeat.findUnique).mockResolvedValue({ lastFinishedAt: new Date("2026-11-18T07:20:00Z") } as never);

    const d = await buildBackfillDigest(NOW);
    expect(d.recentRuns).toHaveLength(3);
    expect(d.needsYou.map((n) => [n.id, n.why])).toEqual([
      ["r3", "G8: the archive contains phone numbers or email addresses"],
      ["r4", "lease expired over an hour ago"],
    ]);
    expect(d.piiLeaks).toEqual([{ id: "r3", prNumber: 3 }]);
    expect(d.archiveDrops24h).toEqual({ k1: { cutoff: 3, correction: 1 } });
    expect(d.statusLineChanges).toEqual([{ id: "r2", before: "We haven't seen a run", after: "Last run we saw: 1 Mar" }]);
    expect(d.watch).toEqual({ lastFinishedAt: "2026-11-18T07:20:00.000Z", stale: true });
  });
});
