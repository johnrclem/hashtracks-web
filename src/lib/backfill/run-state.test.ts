import { prisma } from "@/lib/db";
import { kennelStatusLine } from "./run-state";

vi.mock("@/lib/db", () => ({ prisma: { kennel: { findUnique: vi.fn() } } }));

describe("kennelStatusLine evidence serialization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("serializes dates as ISO strings and passes lastConfirmedVia through as a string", async () => {
    const d = new Date("2026-11-01T12:00:00Z");
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({
      lastRunSeenAt: d,
      nextRunPostedAt: null,
      lastConfirmedAt: d,
      lastConfirmedVia: "HALF_MIND",
      stoppedAt: null,
    } as never);
    const res = await kennelStatusLine("k1", new Date("2026-11-17T12:00:00Z"));
    expect(res.evidence).toEqual({
      lastRunSeenAt: d.toISOString(),
      nextRunPostedAt: null,
      lastConfirmedAt: d.toISOString(),
      lastConfirmedVia: "HALF_MIND",
      stoppedAt: null,
    });
  });

  it("falls back to all-null evidence for a missing kennel", async () => {
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue(null as never);
    const res = await kennelStatusLine("gone");
    expect(res.evidence.lastConfirmedVia).toBeNull();
  });
});
