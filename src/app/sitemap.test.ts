import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import sitemap from "./sitemap";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.kennel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.event.findMany).mockResolvedValue([] as never);
});

describe("sitemap", () => {
  it("leaves listing-only kennels out (they are noindex)", async () => {
    await sitemap();
    const args = vi.mocked(prisma.kennel.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ isHidden: false, listingOnly: false });
  });
});
