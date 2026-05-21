import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(5),
  },
}));

import { prisma } from "@/lib/db";
import { backfillLastEventDates } from "./backfill-last-event";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backfillLastEventDates", () => {
  it("returns the number of updated rows", async () => {
    const result = await backfillLastEventDates();
    expect(result).toBe(5);
  });

  it("calls $executeRaw", async () => {
    await backfillLastEventDates();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when no rows need updating", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(0);
    const result = await backfillLastEventDates();
    expect(result).toBe(0);
  });

  // #1567: lastEventDate must include EventKennel co-host secondaries, but
  // still exclude CANCELLED + manual entries. Introspect the tagged-template
  // strings to lock in the SQL shape.
  it("(#1567) joins through EventKennel so co-host secondaries are counted", async () => {
    await backfillLastEventDates();
    const [strings] = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown as [readonly string[]];
    const sql = strings.join("?");
    expect(sql).toContain(`"EventKennel"`);
    expect(sql).toContain(`"kennelId"`);
    expect(sql).toContain("CANCELLED");
    expect(sql).toContain("isManualEntry");
    // Matches the display-path predicate used by src/app/kennels/* so the
    // cached date can't diverge from what the kennel page renders.
    expect(sql).toContain("isCanonical");
    // Lock the UNION ALL shape — a future regression to `OR EXISTS (...)`
    // would reintroduce the per-Kennel nested-loop over Event.
    expect(sql).toMatch(/UNION ALL/i);
  });
});
