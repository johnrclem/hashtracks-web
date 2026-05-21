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

  // #1477: Ipoh H3 STATIC_SCHEDULE had wrong day + wrong time before this fix
  // (`BYDAY=SA` / `17:00` instead of the actual Monday@18:00 from malaysiahash.com).
  // Lock the corrected schedule so a future cut-and-paste from the neighboring
  // JB / Penang sources can't silently regress it back to Saturday.
  it("(#1477) Ipoh H3 STATIC_SCHEDULE emits Monday @ 18:00, not Saturday @ 17:00", () => {
    const ipoh = SOURCES.find((s) => s.name === "Ipoh H3 Static Schedule");
    expect(ipoh).toBeDefined();
    expect(ipoh!.type).toBe("STATIC_SCHEDULE");
    const cfg = (ipoh!.config ?? {}) as { rrule?: string; startTime?: string; kennelTag?: string };
    expect(cfg.kennelTag).toBe("ipoh-h3");
    expect(cfg.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(cfg.startTime).toBe("18:00");
  });
});
