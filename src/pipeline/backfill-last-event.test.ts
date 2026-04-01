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
});
