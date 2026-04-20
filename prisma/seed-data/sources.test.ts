import { SOURCES } from "./sources";

describe("SOURCES seed data invariants (#817 regression guard)", () => {
  it("every (name, type) pair is unique", () => {
    // prisma/seed.ts:363 looks up existing sources by (name, type) as the
    // identity key. Collisions there would collapse two seed rows into one
    // DB row — the exact bug that hit HARRIER_CENTRAL in #817 when the key
    // was (url, type).
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const s of SOURCES) {
      const key = `${s.name}::${s.type}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2) dupes.push(key);
    }
    expect(dupes).toEqual([]);
  });

  it("HARRIER_CENTRAL sources stay distinct even though they share a base URL", () => {
    const hc = SOURCES.filter((s) => s.type === "HARRIER_CENTRAL");
    // Three live sources today (Tokyo H3, Morgantown H3, Singapore Sunday H3).
    // The count guard catches a regression where a seed edit accidentally
    // drops one.
    expect(hc.length).toBeGreaterThanOrEqual(3);

    // They intentionally share a base URL (config-driven REST API).
    const urls = new Set(hc.map((s) => s.url));
    expect(urls.size).toBe(1);

    // But the discriminator lives in `config` — either cityNames or
    // kennelUniqueShortName must be present and distinct per row.
    const discriminators = hc.map((s) => {
      const cfg = (s.config ?? {}) as { cityNames?: string; kennelUniqueShortName?: string };
      return cfg.cityNames ?? cfg.kennelUniqueShortName ?? "";
    });
    expect(discriminators.every((d) => d.length > 0)).toBe(true);
    expect(new Set(discriminators).size).toBe(discriminators.length);
  });
});
