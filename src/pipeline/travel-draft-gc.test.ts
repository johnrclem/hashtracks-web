import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { TravelSearchStatus } from "@/generated/prisma/client";
import { runTravelDraftGc, DRAFT_GC_AGE_DAYS } from "./travel-draft-gc";

vi.mock("@/lib/db", () => ({
  prisma: {
    travelSearch: {
      deleteMany: vi.fn(),
    },
  },
}));

describe("runTravelDraftGc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes DRAFT rows updated before the cutoff", async () => {
    vi.mocked(prisma.travelSearch.deleteMany).mockResolvedValue({ count: 4 } as never);
    const now = new Date("2026-05-01T00:00:00Z");
    const result = await runTravelDraftGc(now);

    expect(result.deleted).toBe(4);
    // Cutoff is now − DRAFT_GC_AGE_DAYS days.
    expect(result.olderThan).toEqual(
      new Date("2026-04-24T00:00:00Z"),
    );
    expect(prisma.travelSearch.deleteMany).toHaveBeenCalledWith({
      where: {
        status: TravelSearchStatus.DRAFT,
        updatedAt: { lt: result.olderThan },
      },
    });
  });

  it("scopes strictly to status DRAFT so ACTIVE/ARCHIVED trips can't be caught mid-transition", async () => {
    vi.mocked(prisma.travelSearch.deleteMany).mockResolvedValue({ count: 0 } as never);
    await runTravelDraftGc();

    const where = vi.mocked(prisma.travelSearch.deleteMany).mock.calls[0][0]!.where!;
    expect(where.status).toBe(TravelSearchStatus.DRAFT);
  });

  it(`uses ${DRAFT_GC_AGE_DAYS} days as the age threshold`, async () => {
    vi.mocked(prisma.travelSearch.deleteMany).mockResolvedValue({ count: 0 } as never);
    const now = new Date("2026-05-10T12:00:00Z");
    const { olderThan } = await runTravelDraftGc(now);
    const diffMs = now.getTime() - olderThan.getTime();
    expect(diffMs).toBe(DRAFT_GC_AGE_DAYS * 24 * 60 * 60 * 1000);
  });
});
