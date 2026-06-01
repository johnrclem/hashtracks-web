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

    // But the discriminator lives in `config` — cityNames, kennelUniqueShortName,
    // or publicKennelId (GUID) must be present and distinct per row.
    const discriminators = hc.map((s) => {
      const cfg = (s.config ?? {}) as {
        cityNames?: string;
        kennelUniqueShortName?: string;
        publicKennelId?: string;
      };
      return cfg.cityNames ?? cfg.kennelUniqueShortName ?? cfg.publicKennelId ?? "";
    });
    expect(discriminators.every((d) => d.length > 0)).toBe(true);
    expect(new Set(discriminators).size).toBe(discriminators.length);
  });

  // #1477: Ipoh H3 STATIC_SCHEDULE had wrong day + wrong time before this fix
  // (`BYDAY=SA` / `17:00` instead of the actual Monday@18:00 from malaysiahash.com).
  // Lock the corrected schedule so a future cut-and-paste from the neighboring
  // JB / Penang sources can't silently regress it back to Saturday.
  // #1431 / #1477 / #1535 / #1537: four SE Asia STATIC_SCHEDULE sources
  // shipped with placeholder `BYDAY=SA` / `17:00` configs instead of their
  // actual schedules from the malaysiahash.com directory. Lock each
  // corrected (kennelTag, rrule, startTime) so a neighbor cut-and-paste
  // can't regress them back to Saturday.
  it.each([
    { name: "Ipoh H3 Static Schedule", tag: "ipoh-h3", rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "18:00", issue: 1477 },
    { name: "Kluang H3 Static Schedule", tag: "kluang-h3", rrule: "FREQ=WEEKLY;BYDAY=WE", startTime: "18:00", issue: 1431 },
    { name: "Kuching H3 Static Schedule", tag: "kuching-h3", rrule: "FREQ=WEEKLY;BYDAY=TU", startTime: "17:30", issue: 1535 },
    { name: "KK H3 Static Schedule", tag: "kk-h3", rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "16:30", issue: 1537 },
  ])("(#$issue) $name emits $rrule @ $startTime, not Saturday @ 17:00", ({ name, tag, rrule, startTime }) => {
    const src = SOURCES.find((s) => s.name === name);
    expect(src).toBeDefined();
    expect(src!.type).toBe("STATIC_SCHEDULE");
    const cfg = (src!.config ?? {}) as { rrule?: string; startTime?: string; kennelTag?: string };
    expect(cfg.kennelTag).toBe(tag);
    expect(cfg.rrule).toBe(rrule);
    expect(cfg.startTime).toBe(startTime);
  });
});
