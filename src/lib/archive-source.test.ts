import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { source: { findUnique: vi.fn() }, sourceKennel: { findFirst: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { isArchiveSource, kennelHasArchiveSource } from "./archive-source";

describe("archive-source guards", () => {
  it("isArchiveSource reads only the flag", async () => {
    vi.mocked(prisma.source.findUnique).mockResolvedValueOnce({ archiveOnly: true } as never);
    expect(await isArchiveSource("s1")).toBe(true);
    vi.mocked(prisma.source.findUnique).mockResolvedValueOnce(null);
    expect(await isArchiveSource("missing")).toBe(false);
  });

  it("kennelHasArchiveSource looks for a link to an archive source", async () => {
    vi.mocked(prisma.sourceKennel.findFirst).mockResolvedValueOnce({ id: "sk" } as never);
    expect(await kennelHasArchiveSource("k1")).toBe(true);
    expect(vi.mocked(prisma.sourceKennel.findFirst).mock.calls[0][0]).toMatchObject({
      where: { kennelId: "k1", source: { archiveOnly: true } },
    });
  });
});
