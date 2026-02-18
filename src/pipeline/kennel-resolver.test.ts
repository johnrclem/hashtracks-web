import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapKennelTag, clearResolverCache, resolveKennelTag } from "./kennel-resolver";

// ── mapKennelTag (pure function) ──

describe("mapKennelTag", () => {
  it("maps 'ballbuster' → BoBBH3", () => {
    expect(mapKennelTag("ballbuster")).toBe("BoBBH3");
  });

  it("maps 'bobbh3' → BoBBH3", () => {
    expect(mapKennelTag("bobbh3")).toBe("BoBBH3");
  });

  it("maps 'queens black knights' → QBK", () => {
    expect(mapKennelTag("queens black knights")).toBe("QBK");
  });

  it("maps 'new amsterdam' → NAH3", () => {
    expect(mapKennelTag("new amsterdam")).toBe("NAH3");
  });

  it("maps 'nass...' → NAH3", () => {
    expect(mapKennelTag("nassau hash")).toBe("NAH3");
  });

  it("maps 'long island' → LIL", () => {
    expect(mapKennelTag("long island")).toBe("LIL");
  });

  it("maps 'lunatics' → LIL", () => {
    expect(mapKennelTag("lunatics")).toBe("LIL");
  });

  it("maps 'staten island' → SI", () => {
    expect(mapKennelTag("staten island")).toBe("SI");
  });

  it("maps 'drinking practice' → Drinking Practice (NYC)", () => {
    expect(mapKennelTag("drinking practice")).toBe("Drinking Practice (NYC)");
  });

  it("maps 'knickerbocker' → Knick", () => {
    expect(mapKennelTag("knickerbocker")).toBe("Knick");
  });

  it("maps 'pink taco' → Pink Taco", () => {
    expect(mapKennelTag("pink taco")).toBe("Pink Taco");
  });

  it("maps 'brooklyn' prefix → BrH3", () => {
    expect(mapKennelTag("brooklyn hash")).toBe("BrH3");
  });

  it("maps 'brh3' prefix → BrH3", () => {
    expect(mapKennelTag("brh3")).toBe("BrH3");
  });

  it("maps 'naww' → NAWWH3", () => {
    expect(mapKennelTag("naww")).toBe("NAWWH3");
  });

  it("maps 'nah3' → NAH3", () => {
    expect(mapKennelTag("nah3")).toBe("NAH3");
  });

  it("maps 'nyc' → NYCH3", () => {
    expect(mapKennelTag("nyc")).toBe("NYCH3");
  });

  it("maps 'nych3' → NYCH3", () => {
    expect(mapKennelTag("nych3")).toBe("NYCH3");
  });

  it("maps 'boston hash' → BoH3", () => {
    expect(mapKennelTag("boston hash")).toBe("BoH3");
  });

  it("maps 'bh3' → BoH3", () => {
    expect(mapKennelTag("bh3")).toBe("BoH3");
  });

  it("maps 'boh3' → BoH3", () => {
    expect(mapKennelTag("boh3")).toBe("BoH3");
  });

  it("maps 'moon' → Bos Moon", () => {
    expect(mapKennelTag("moon")).toBe("Bos Moon");
  });

  it("maps 'moom' (typo) → Bos Moon", () => {
    expect(mapKennelTag("moom")).toBe("Bos Moon");
  });

  it("maps 'beantown' → Beantown", () => {
    expect(mapKennelTag("beantown")).toBe("Beantown");
  });

  it("maps 'summit' → Summit", () => {
    expect(mapKennelTag("summit")).toBe("Summit");
  });

  it("maps 'asssh3' → ASSSH3", () => {
    expect(mapKennelTag("asssh3")).toBe("ASSSH3");
  });

  it("maps 'sfm' → SFM", () => {
    expect(mapKennelTag("sfm")).toBe("SFM");
  });

  it("maps 'queens' → QBK", () => {
    expect(mapKennelTag("queens")).toBe("QBK");
  });

  it("maps 'knick' → Knick", () => {
    expect(mapKennelTag("knick")).toBe("Knick");
  });

  it("maps 'columbia' → Columbia", () => {
    expect(mapKennelTag("columbia")).toBe("Columbia");
  });

  it("maps 'ggfm' → GGFM", () => {
    expect(mapKennelTag("ggfm")).toBe("GGFM");
  });

  it("maps 'harriettes' → Harriettes", () => {
    expect(mapKennelTag("harriettes")).toBe("Harriettes");
  });

  it("maps 'si' → SI", () => {
    expect(mapKennelTag("si")).toBe("SI");
  });

  it("maps 'special' → Special (NYC)", () => {
    expect(mapKennelTag("special")).toBe("Special (NYC)");
  });

  it("maps 'ch3' → CH3", () => {
    expect(mapKennelTag("ch3")).toBe("CH3");
  });

  it("maps 'chicago' → CH3", () => {
    expect(mapKennelTag("chicago hash")).toBe("CH3");
  });

  it("maps 'ben franklin' → BFM", () => {
    expect(mapKennelTag("ben franklin")).toBe("BFM");
  });

  it("maps 'rumson' → Rumson", () => {
    expect(mapKennelTag("rumson")).toBe("Rumson");
  });

  it("returns null for unknown input", () => {
    expect(mapKennelTag("xyzzy123")).toBeNull();
  });
});

// ── resolveKennelTag (DB-dependent) ──

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findFirst: vi.fn() },
    kennelAlias: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
const mockKennelFind = vi.mocked(prisma.kennel.findFirst);
const mockAliasFind = vi.mocked(prisma.kennelAlias.findFirst);

describe("resolveKennelTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearResolverCache();
  });

  it("returns unmatched for empty tag", async () => {
    const result = await resolveKennelTag("");
    expect(result).toEqual({ kennelId: null, matched: false });
    expect(mockKennelFind).not.toHaveBeenCalled();
  });

  it("returns unmatched for whitespace-only tag", async () => {
    const result = await resolveKennelTag("   ");
    expect(result).toEqual({ kennelId: null, matched: false });
  });

  it("resolves via exact shortName match", async () => {
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);
    const result = await resolveKennelTag("NYCH3");
    expect(result).toEqual({ kennelId: "kennel_1", matched: true });
  });

  it("resolves via alias match", async () => {
    mockKennelFind.mockResolvedValueOnce(null);
    mockAliasFind.mockResolvedValueOnce({ kennelId: "kennel_2" } as never);
    const result = await resolveKennelTag("NYC Hash");
    expect(result).toEqual({ kennelId: "kennel_2", matched: true });
  });

  it("resolves via pattern fallback", async () => {
    // First: shortName miss, alias miss, then pattern maps "queens" → "QBK"
    mockKennelFind.mockResolvedValueOnce(null); // initial shortName
    mockAliasFind.mockResolvedValueOnce(null);    // alias
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_qbk" } as never); // pattern re-lookup
    const result = await resolveKennelTag("queens");
    expect(result).toEqual({ kennelId: "kennel_qbk", matched: true });
  });

  it("returns unmatched when all stages fail", async () => {
    mockKennelFind.mockResolvedValue(null);
    mockAliasFind.mockResolvedValue(null);
    const result = await resolveKennelTag("xyzzy_unknown");
    expect(result).toEqual({ kennelId: null, matched: false });
  });

  it("uses cache on second call", async () => {
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);
    await resolveKennelTag("NYCH3");
    await resolveKennelTag("NYCH3");
    expect(mockKennelFind).toHaveBeenCalledTimes(1);
  });

  it("cache is cleared by clearResolverCache", async () => {
    mockKennelFind.mockResolvedValue({ id: "kennel_1" } as never);
    await resolveKennelTag("NYCH3");
    clearResolverCache();
    await resolveKennelTag("NYCH3");
    expect(mockKennelFind).toHaveBeenCalledTimes(2);
  });

  it("normalizes case for cache key", async () => {
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);
    await resolveKennelTag("NYCH3");
    const result = await resolveKennelTag("nych3");
    expect(result).toEqual({ kennelId: "kennel_1", matched: true });
    expect(mockKennelFind).toHaveBeenCalledTimes(1);
  });

  it("prefers source-linked kennel when sourceId is provided", async () => {
    // Source-scoped query returns the linked kennel
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_boston" } as never);
    const result = await resolveKennelTag("CH3", "source_123");
    expect(result).toEqual({ kennelId: "kennel_boston", matched: true });
    // First call should include sourceKennels filter
    expect(mockKennelFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sources: { some: { sourceId: "source_123" } },
        }),
      }),
    );
  });

  it("falls back to any kennel when source-scoped query misses", async () => {
    mockKennelFind
      .mockResolvedValueOnce(null)                         // source-scoped miss
      .mockResolvedValueOnce({ id: "kennel_any" } as never); // fallback hit
    const result = await resolveKennelTag("CH3", "source_456");
    expect(result).toEqual({ kennelId: "kennel_any", matched: true });
    expect(mockKennelFind).toHaveBeenCalledTimes(2);
  });

  it("uses separate cache entries for different sourceIds", async () => {
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_a" } as never);
    await resolveKennelTag("CH3", "source_1");

    mockKennelFind.mockResolvedValueOnce({ id: "kennel_b" } as never);
    await resolveKennelTag("CH3", "source_2");

    // Should have made 2 DB calls (different cache keys)
    expect(mockKennelFind).toHaveBeenCalledTimes(2);
  });
});
