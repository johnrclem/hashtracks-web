import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRawEvent } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findMany: vi.fn() },
    sourceKennel: { count: vi.fn() },
    $disconnect: vi.fn(),
  },
}));
vi.mock("@/pipeline/merge", () => ({ processRawEvents: vi.fn() }));

import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";
import { reportAndApplyBackfill } from "./backfill-runner";

const baseResult = {
  created: 0, createdEventIds: [], updated: 0, skipped: 0, unmatched: [], blocked: 0, blockedTags: [],
  restored: 0, eventErrors: 0, eventErrorMessages: [],
};

describe("reportAndApplyBackfill", () => {
  beforeEach(() => {
    vi.mocked(prisma.source.findMany).mockResolvedValue([{ id: "src_1" }] as never);
    vi.mocked(prisma.sourceKennel.count).mockResolvedValue(1 as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("throws when an archive cutoff dropped rows, instead of reporting created=0", async () => {
    vi.mocked(processRawEvents).mockResolvedValue({ ...baseResult, archiveCutoffDropped: 3 });
    await expect(reportAndApplyBackfill({
      apply: true, sourceName: "X", kennelTimezone: "UTC", events: [buildRawEvent({ date: "2020-01-01" })],
    })).rejects.toThrow(/3 rows DROPPED by an archive cutoff/);
  });

  it("passes when nothing was dropped", async () => {
    vi.mocked(processRawEvents).mockResolvedValue({ ...baseResult, created: 1, archiveCutoffDropped: 0 });
    await expect(reportAndApplyBackfill({
      apply: true, sourceName: "X", kennelTimezone: "UTC", events: [buildRawEvent({ date: "2020-01-01" })],
    })).resolves.toBeUndefined();
  });
});
