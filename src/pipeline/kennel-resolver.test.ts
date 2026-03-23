import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapKennelTag, clearResolverCache, resolveKennelTag } from "./kennel-resolver";

// ── mapKennelTag (pure function) ──

describe("mapKennelTag", () => {
  it("maps 'ballbuster' → bobbh3", () => {
    expect(mapKennelTag("ballbuster")).toBe("bobbh3");
  });

  it("maps 'bobbh3' → bobbh3", () => {
    expect(mapKennelTag("bobbh3")).toBe("bobbh3");
  });

  it("maps 'b3h4' → bobbh3", () => {
    expect(mapKennelTag("b3h4")).toBe("bobbh3");
  });

  it("maps 'queens black knights' → qbk", () => {
    expect(mapKennelTag("queens black knights")).toBe("qbk");
  });

  it("maps 'new amsterdam' → nah3", () => {
    expect(mapKennelTag("new amsterdam")).toBe("nah3");
  });

  it("maps 'nass...' → nah3", () => {
    expect(mapKennelTag("nassau hash")).toBe("nah3");
  });

  it("maps 'long island' → lil", () => {
    expect(mapKennelTag("long island")).toBe("lil");
  });

  it("maps 'lunatics' → lil", () => {
    expect(mapKennelTag("lunatics")).toBe("lil");
  });

  it("maps 'staten island' → si", () => {
    expect(mapKennelTag("staten island")).toBe("si");
  });

  it("maps 'drinking practice' → drinking-practice-nyc", () => {
    expect(mapKennelTag("drinking practice")).toBe("drinking-practice-nyc");
  });

  it("maps 'knickerbocker' → knick", () => {
    expect(mapKennelTag("knickerbocker")).toBe("knick");
  });

  it("maps 'pink taco' → pink-taco", () => {
    expect(mapKennelTag("pink taco")).toBe("pink-taco");
  });

  it("maps 'pt2h3' → pink-taco", () => {
    expect(mapKennelTag("pt2h3")).toBe("pink-taco");
  });

  it("maps 'brooklyn' prefix → brh3", () => {
    expect(mapKennelTag("brooklyn hash")).toBe("brh3");
  });

  it("maps 'brh3' prefix → brh3", () => {
    expect(mapKennelTag("brh3")).toBe("brh3");
  });

  it("maps 'naww' → nawwh3", () => {
    expect(mapKennelTag("naww")).toBe("nawwh3");
  });

  it("maps 'nah3' → nah3", () => {
    expect(mapKennelTag("nah3")).toBe("nah3");
  });

  it("maps 'nyc' → nych3", () => {
    expect(mapKennelTag("nyc")).toBe("nych3");
  });

  it("maps 'nych3' → nych3", () => {
    expect(mapKennelTag("nych3")).toBe("nych3");
  });

  it("maps 'boston hash' → boh3", () => {
    expect(mapKennelTag("boston hash")).toBe("boh3");
  });

  it("maps 'bh3' → boh3", () => {
    expect(mapKennelTag("bh3")).toBe("boh3");
  });

  it("maps 'boh3' → boh3", () => {
    expect(mapKennelTag("boh3")).toBe("boh3");
  });

  it("maps 'moon' → bos-moon", () => {
    expect(mapKennelTag("moon")).toBe("bos-moon");
  });

  it("maps 'moom' (typo) → bos-moon", () => {
    expect(mapKennelTag("moom")).toBe("bos-moon");
  });

  it("maps 'beantown' → beantown", () => {
    expect(mapKennelTag("beantown")).toBe("beantown");
  });

  it("maps 'summit' → summit", () => {
    expect(mapKennelTag("summit")).toBe("summit");
  });

  it("maps 'asssh3' → asssh3", () => {
    expect(mapKennelTag("asssh3")).toBe("asssh3");
  });

  it("maps 'sfm' → sfm", () => {
    expect(mapKennelTag("sfm")).toBe("sfm");
  });

  it("maps 'queens' → qbk", () => {
    expect(mapKennelTag("queens")).toBe("qbk");
  });

  it("maps 'knick' → knick", () => {
    expect(mapKennelTag("knick")).toBe("knick");
  });

  it("maps 'columbia' → columbia", () => {
    expect(mapKennelTag("columbia")).toBe("columbia");
  });

  it("maps 'ggfm' → ggfm", () => {
    expect(mapKennelTag("ggfm")).toBe("ggfm");
  });

  it("maps 'harriettes' → harriettes-nyc", () => {
    expect(mapKennelTag("harriettes")).toBe("harriettes-nyc");
  });

  it("maps 'si' → si", () => {
    expect(mapKennelTag("si")).toBe("si");
  });

  it("maps 'special' → special-nyc", () => {
    expect(mapKennelTag("special")).toBe("special-nyc");
  });

  it("maps 'ch3' → ch3", () => {
    expect(mapKennelTag("ch3")).toBe("ch3");
  });

  it("maps 'chicago' → ch3", () => {
    expect(mapKennelTag("chicago hash")).toBe("ch3");
  });

  it("maps 'ben franklin' → bfm", () => {
    expect(mapKennelTag("ben franklin")).toBe("bfm");
  });

  it("maps 'rumson' → rumson", () => {
    expect(mapKennelTag("rumson")).toBe("rumson");
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
    mockKennelFind.mockResolvedValueOnce(null);                          // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);   // shortName hit
    const result = await resolveKennelTag("NYCH3");
    expect(result).toEqual({ kennelId: "kennel_1", matched: true });
  });

  it("resolves via alias match", async () => {
    mockKennelFind.mockResolvedValueOnce(null);                          // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce(null);                          // shortName miss
    mockAliasFind.mockResolvedValueOnce({ kennelId: "kennel_2" } as never);
    const result = await resolveKennelTag("NYC Hash");
    expect(result).toEqual({ kennelId: "kennel_2", matched: true });
  });

  it("resolves via pattern fallback", async () => {
    // kennelCode miss, shortName miss, alias miss, then pattern maps "queens" → "QBK"
    mockKennelFind.mockResolvedValueOnce(null);                            // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce(null);                            // initial shortName
    mockAliasFind.mockResolvedValueOnce(null);                             // alias
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_qbk" } as never);  // pattern re-lookup
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
    mockKennelFind.mockResolvedValueOnce(null);                          // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);   // shortName hit
    await resolveKennelTag("NYCH3");
    await resolveKennelTag("NYCH3");
    expect(mockKennelFind).toHaveBeenCalledTimes(2); // kennelCode + shortName (first call only)
  });

  it("cache is cleared by clearResolverCache", async () => {
    // First call: kennelCode miss (global) + shortName hit = 2 findFirst calls
    mockKennelFind.mockResolvedValueOnce(null);                          // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);   // shortName hit
    await resolveKennelTag("NYCH3");
    clearResolverCache();
    // After cache clear: same 2 calls again
    mockKennelFind.mockResolvedValueOnce(null);                          // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);   // shortName hit
    await resolveKennelTag("NYCH3");
    expect(mockKennelFind).toHaveBeenCalledTimes(4);
  });

  it("normalizes case for cache key", async () => {
    mockKennelFind.mockResolvedValueOnce(null);                          // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_1" } as never);   // shortName hit
    await resolveKennelTag("NYCH3");
    const result = await resolveKennelTag("nych3");
    expect(result).toEqual({ kennelId: "kennel_1", matched: true });
    expect(mockKennelFind).toHaveBeenCalledTimes(2); // kennelCode + shortName (first call only)
  });

  it("prefers source-linked kennel when sourceId is provided", async () => {
    mockKennelFind.mockResolvedValueOnce(null);                              // kennelCode source-scoped miss
    mockKennelFind.mockResolvedValueOnce(null);                              // kennelCode global miss
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_boston" } as never);   // shortName source-scoped hit
    const result = await resolveKennelTag("CH3", "source_123");
    expect(result).toEqual({ kennelId: "kennel_boston", matched: true });
    // Third call (shortName source-scoped) should include sourceKennels filter
    expect(mockKennelFind).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        where: expect.objectContaining({
          shortName: { equals: "CH3", mode: "insensitive" },
          sources: { some: { sourceId: "source_123" } },
        }),
      }),
    );
  });

  it("falls back to any kennel when source-scoped query misses", async () => {
    mockKennelFind
      .mockResolvedValueOnce(null)                              // kennelCode source-scoped miss
      .mockResolvedValueOnce(null)                              // kennelCode global miss
      .mockResolvedValueOnce(null)                              // shortName source-scoped miss
      .mockResolvedValueOnce({ id: "kennel_any" } as never);    // shortName global hit
    const result = await resolveKennelTag("CH3", "source_456");
    expect(result).toEqual({ kennelId: "kennel_any", matched: true });
    expect(mockKennelFind).toHaveBeenCalledTimes(4);
  });

  it("uses separate cache entries for different sourceIds", async () => {
    // First call: kennelCode source-scoped hit
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_a" } as never);
    await resolveKennelTag("CH3", "source_1");

    // Second call: different sourceId, kennelCode source-scoped hit
    mockKennelFind.mockResolvedValueOnce({ id: "kennel_b" } as never);
    await resolveKennelTag("CH3", "source_2");

    // Should have made 2 DB calls (different cache keys)
    expect(mockKennelFind).toHaveBeenCalledTimes(2);
  });
});

// ── kennelCode resolution (Step 0) ──

describe("kennelCode resolution (Step 0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearResolverCache();
  });

  it("resolves via kennelCode when source-scoped", async () => {
    mockKennelFind.mockResolvedValueOnce({ id: "dallas-id" } as never); // kennelCode source-scoped hit
    const result = await resolveKennelTag("dh3-tx", "dfw-source-id");
    expect(result.matched).toBe(true);
    expect(result.kennelId).toBe("dallas-id");
    // Verify it queried by kennelCode, not shortName
    expect(mockKennelFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelCode: { equals: "dh3-tx", mode: "insensitive" },
        }),
      }),
    );
  });

  it("falls back to global kennelCode match without sourceId", async () => {
    // Global kennelCode hit (no sourceId, so no source-scoped call)
    mockKennelFind.mockResolvedValueOnce({ id: "dallas-id" } as never);
    const result = await resolveKennelTag("dh3-tx");
    expect(result.matched).toBe(true);
    expect(result.kennelId).toBe("dallas-id");
  });

  it("falls back to global kennelCode when source-scoped misses", async () => {
    mockKennelFind
      .mockResolvedValueOnce(null)                            // kennelCode source-scoped miss
      .mockResolvedValueOnce({ id: "dallas-id" } as never);   // kennelCode global hit
    const result = await resolveKennelTag("dh3-tx", "other-source");
    expect(result.matched).toBe(true);
    expect(result.kennelId).toBe("dallas-id");
  });

  it("falls through to shortName match when kennelCode doesn't match", async () => {
    mockKennelFind
      .mockResolvedValueOnce(null)                              // kennelCode global miss
      .mockResolvedValueOnce({ id: "denver-id" } as never);     // shortName hit
    const result = await resolveKennelTag("DH3");
    expect(result.matched).toBe(true);
    expect(result.kennelId).toBe("denver-id");
  });
});
