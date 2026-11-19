import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory fake of the three tables the resolver reads ──

interface FakeKennel {
  id: string;
  kennelCode: string;
  shortName: string;
  fullName: string;
  aliases: string[];
  sources: string[];
}

const db = vi.hoisted(() => ({
  kennels: [] as FakeKennel[],
  sources: new Map<string, unknown>(),
}));

type Where = Record<string, unknown>;
const ieq = (a: string, cond: unknown) =>
  a.toLowerCase() === String((cond as { equals: string }).equals).toLowerCase();
const linked = (k: FakeKennel, rel: unknown) =>
  !rel || k.sources.includes((rel as { some: { sourceId: string } }).some.sourceId);

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
        db.kennels
          .filter((k) =>
            (["kennelCode", "shortName", "fullName"] as const).every(
              (f) => !(f in where) || ieq(k[f], where[f]),
            ) && linked(k, where.sources),
          )
          .sort((a, b) => a.kennelCode.localeCompare(b.kennelCode))
          .slice(0, take)
          .map((k) => ({ id: k.id, kennelCode: k.kennelCode })),
      ),
    },
    kennelAlias: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
        db.kennels
          .filter(
            (k) =>
              k.aliases.some((a) => ieq(a, where.alias)) &&
              linked(k, (where.kennel as { sources?: unknown } | undefined)?.sources),
          )
          .slice(0, take)
          .map((k) => ({ kennel: { id: k.id, kennelCode: k.kennelCode } })),
      ),
    },
    source: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        db.sources.has(where.id) ? { config: db.sources.get(where.id) } : null,
      ),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  clearResolverCache,
  describeUnmatched,
  mapKennelTagForSource,
  resolveKennelTag,
  resolveKennelTags,
} from "./kennel-resolver";

function kennel(k: Partial<FakeKennel> & { id: string; kennelCode: string }): FakeKennel {
  return { shortName: k.kennelCode.toUpperCase(), fullName: `${k.kennelCode} HHH`, aliases: [], sources: [], ...k };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearResolverCache();
  db.kennels = [];
  db.sources = new Map();
});

describe("resolveKennelTag — direct steps", () => {
  it("returns unmatched for an empty or whitespace tag without querying", async () => {
    expect(await resolveKennelTag("")).toEqual({ kennelId: null, matched: false });
    expect(await resolveKennelTag("   ")).toEqual({ kennelId: null, matched: false });
    expect(prisma.kennel.findMany).not.toHaveBeenCalled();
  });

  it("resolves by kennelCode, case-insensitively", async () => {
    db.kennels = [kennel({ id: "k1", kennelCode: "dh3-tx" })];
    expect(await resolveKennelTag("DH3-TX")).toEqual({ kennelId: "k1", matched: true });
  });

  it("resolves by shortName", async () => {
    db.kennels = [kennel({ id: "k1", kennelCode: "nych3", shortName: "NYCH3" })];
    expect(await resolveKennelTag("nych3")).toEqual({ kennelId: "k1", matched: true });
  });

  it("resolves by alias", async () => {
    db.kennels = [kennel({ id: "k1", kennelCode: "nych3", aliases: ["NYC Hash"] })];
    expect(await resolveKennelTag("nyc hash")).toEqual({ kennelId: "k1", matched: true });
  });

  it("returns plain unmatched when nothing matches", async () => {
    db.kennels = [kennel({ id: "k1", kennelCode: "nych3" })];
    expect(await resolveKennelTag("xyzzy")).toEqual({ kennelId: null, matched: false });
  });

  it("prefers the source-linked kennel when a short name is shared", async () => {
    db.kennels = [
      kennel({ id: "boston", kennelCode: "ch3-ma", shortName: "CH3", sources: ["src_boston"] }),
      kennel({ id: "chicago", kennelCode: "ch3-il", shortName: "CH3" }),
      kennel({ id: "charlotte", kennelCode: "ch3-nc", shortName: "CH3" }),
    ];
    expect(await resolveKennelTag("CH3", "src_boston")).toEqual({ kennelId: "boston", matched: true });
  });

  it("falls back to a single global match when the source-scoped lookup misses", async () => {
    db.kennels = [kennel({ id: "k1", kennelCode: "nych3", aliases: ["Big Apple"] })];
    expect(await resolveKennelTag("big apple", "src_other")).toEqual({ kennelId: "k1", matched: true });
  });

  it("caches per tag (case-insensitive) and per source", async () => {
    db.kennels = [kennel({ id: "k1", kennelCode: "nych3" })];
    await resolveKennelTag("NYCH3");
    await resolveKennelTag("nych3");
    expect(prisma.kennel.findMany).toHaveBeenCalledTimes(1);
    await resolveKennelTag("nych3", "src_1");
    expect(prisma.kennel.findMany).toHaveBeenCalledTimes(3); // scoped miss + global hit
    clearResolverCache();
    await resolveKennelTag("nych3");
    expect(prisma.kennel.findMany).toHaveBeenCalledTimes(4);
  });
});

describe("resolveKennelTag — ambiguity (R6)", () => {
  it("returns unmatched with candidates when a global alias names two kennels", async () => {
    db.kennels = [
      kennel({ id: "a", kennelCode: "fmh3-sd", aliases: ["Full Moon"] }),
      kennel({ id: "b", kennelCode: "cfmh3", aliases: ["full moon"] }),
    ];
    const result = await resolveKennelTag("Full Moon", "src_unrelated");
    expect(result).toEqual({
      kennelId: null,
      matched: false,
      reason: "ambiguous",
      candidates: ["cfmh3", "fmh3-sd"],
    });
    expect(describeUnmatched("Full Moon", result)).toContain("cfmh3, fmh3-sd");
  });

  it("returns ambiguous for a duplicated short name with no linked kennel", async () => {
    db.kennels = [
      kennel({ id: "a", kennelCode: "ch3-il", shortName: "CH3" }),
      kennel({ id: "b", kennelCode: "ch3-nc", shortName: "CH3" }),
    ];
    expect(await resolveKennelTag("CH3")).toMatchObject({ matched: false, reason: "ambiguous" });
    expect(await resolveKennelTag("ch3-nc")).toEqual({ kennelId: "b", matched: true });
  });

  it("lets a later step settle a tag an earlier step found ambiguous", async () => {
    db.kennels = [
      kennel({ id: "a", kennelCode: "sh3-wa", shortName: "SH3" }),
      kennel({ id: "b", kennelCode: "sh3-de", shortName: "SH3" }),
      kennel({ id: "c", kennelCode: "sh3-sg", aliases: ["SH3"] }),
    ];
    expect(await resolveKennelTag("SH3")).toEqual({ kennelId: "c", matched: true });
  });

  it("source-scoped hit wins over a globally ambiguous alias", async () => {
    db.kennels = [
      kennel({ id: "a", kennelCode: "h4-tx", aliases: ["H4"] }),
      kennel({ id: "b", kennelCode: "h4-dc", aliases: ["H4"], sources: ["src_dc"] }),
    ];
    expect(await resolveKennelTag("H4", "src_dc")).toEqual({ kennelId: "b", matched: true });
    expect((await resolveKennelTag("H4")).reason).toBe("ambiguous");
  });

  it("describes a plain miss as create-kennel-or-alias", () => {
    expect(describeUnmatched("Foo", { kennelId: null, matched: false })).toBe(
      'Create kennel or alias for "Foo"',
    );
  });
});

describe("resolveKennelTag — full name (R6)", () => {
  it("matches the full name of a kennel linked to the source", async () => {
    db.kennels = [
      kennel({ id: "oh3", kennelCode: "oh3", fullName: "Oregon Hash House Harriers", sources: ["src_rego"] }),
    ];
    expect(await resolveKennelTag("oregon hash house harriers", "src_rego")).toEqual({
      kennelId: "oh3",
      matched: true,
    });
  });

  it("ignores full names of kennels not linked to the source, and without a source", async () => {
    db.kennels = [kennel({ id: "oh3", kennelCode: "oh3", fullName: "Oregon Hash House Harriers" })];
    expect((await resolveKennelTag("Oregon Hash House Harriers", "src_rego")).matched).toBe(false);
    expect((await resolveKennelTag("Oregon Hash House Harriers")).matched).toBe(false);
  });
});

describe("resolveKennelTag — per-source patterns (R6)", () => {
  beforeEach(() => {
    db.kennels = [
      kennel({ id: "bfm", kennelCode: "bfm", sources: ["src_rego"] }),
      kennel({ id: "moon", kennelCode: "bos-moon", sources: ["src_boston"] }),
    ];
    db.sources.set("src_rego", { kennelPatterns: [["^Ben Franklin Mob\\b", "bfm"]] });
    db.sources.set("src_boston", { kennelPatterns: [["Boston Moo[mn]|\\bMo{2,}[mn]\\b", "bos-moon"]] });
    db.sources.set("src_colorado", { kennelPatterns: [["Boulder H3", "bh3-co"]] });
  });

  it("maps a tag with the source's own kennelPatterns", async () => {
    expect(await resolveKennelTag("Ben Franklin Mob H3", "src_rego")).toEqual({ kennelId: "bfm", matched: true });
    expect(await resolveKennelTag("MOOOOOOM TRAIL", "src_boston")).toEqual({ kennelId: "moon", matched: true });
  });

  it("no longer applies another source's patterns (the old global list)", async () => {
    expect((await resolveKennelTag("Colorado Full Moon Hash", "src_colorado")).matched).toBe(false);
    expect((await resolveKennelTag("Ben Franklin Mob H3", "src_boston")).matched).toBe(false);
    expect((await resolveKennelTag("Ben Franklin Mob H3")).matched).toBe(false);
  });

  it("tolerates a source with no or malformed config", async () => {
    db.sources.set("src_bad", { kennelPatterns: [["(", "bfm"], "junk", [1, 2]] });
    expect(await mapKennelTagForSource("anything", "src_bad")).toBeNull();
    expect(await mapKennelTagForSource("anything", "src_missing")).toBeNull();
    expect(await mapKennelTagForSource("anything", undefined)).toBeNull();
  });

  it("loads a source's config once per run", async () => {
    await resolveKennelTag("Ben Franklin Mob H3", "src_rego");
    await resolveKennelTag("Ben Franklin Mob H4", "src_rego");
    expect(prisma.source.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("resolveKennelTags", () => {
  it("preserves order and reports per-tag results", async () => {
    db.kennels = [kennel({ id: "a", kennelCode: "nych3" }), kennel({ id: "b", kennelCode: "brh3" })];
    expect(await resolveKennelTags(["brh3", "nope", "nych3"])).toEqual([
      { kennelId: "b", matched: true },
      { kennelId: null, matched: false },
      { kennelId: "a", matched: true },
    ]);
  });
});
