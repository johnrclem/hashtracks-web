import { describe, it, expect } from "vitest";
import {
  parseScheduleTime,
  parseFrequencyDay,
  normalizeRRule,
  runStaticSchedulePass,
  runKennelSeedPass,
  runKennelDisplayPass,
  applyUpserts,
  planSeedRule,
} from "./backfill-schedule-rules";
import type { KennelScheduleRuleSeed } from "../prisma/seed-data/kennels";

describe("parseScheduleTime", () => {
  it("parses PM times to 24-hour", () => {
    expect(parseScheduleTime("7:00 PM")).toBe("19:00");
    expect(parseScheduleTime("12:30 PM")).toBe("12:30");
    expect(parseScheduleTime("2:00 PM")).toBe("14:00");
    expect(parseScheduleTime("11:59 PM")).toBe("23:59");
  });

  it("parses AM times to 24-hour", () => {
    expect(parseScheduleTime("10:00 AM")).toBe("10:00");
    expect(parseScheduleTime("9:30 AM")).toBe("09:30");
    expect(parseScheduleTime("12:00 AM")).toBe("00:00");
    expect(parseScheduleTime("12:30 AM")).toBe("00:30");
  });

  it("handles single-digit hours and missing minutes", () => {
    expect(parseScheduleTime("7 PM")).toBe("19:00");
    expect(parseScheduleTime("9 AM")).toBe("09:00");
  });

  it("handles Noon and Midnight literals", () => {
    expect(parseScheduleTime("12:00 Noon")).toBe("12:00");
    expect(parseScheduleTime("noon")).toBe("12:00");
    expect(parseScheduleTime("12:00 Midnight")).toBe("00:00");
    expect(parseScheduleTime("Midnight")).toBe("00:00");
  });

  it("passes through already-24-hour times", () => {
    expect(parseScheduleTime("19:30")).toBe("19:30");
    expect(parseScheduleTime("09:00")).toBe("09:00");
    expect(parseScheduleTime("00:00")).toBe("00:00");
    expect(parseScheduleTime("23:59")).toBe("23:59");
  });

  it("normalizes single-digit 24-hour times to zero-padded", () => {
    expect(parseScheduleTime("9:00")).toBe("09:00");
  });

  it("returns null for unparseable input", () => {
    expect(parseScheduleTime("")).toBeNull();
    expect(parseScheduleTime(null)).toBeNull();
    expect(parseScheduleTime(undefined)).toBeNull();
    expect(parseScheduleTime("sometime")).toBeNull();
    expect(parseScheduleTime("13:00 PM")).toBeNull(); // impossible
    expect(parseScheduleTime("25:00")).toBeNull();    // out of range
  });
});

describe("parseFrequencyDay", () => {
  it("weekly + specific day → one weekly rule at MEDIUM", () => {
    const rules = parseFrequencyDay("Weekly", "Saturday");
    expect(rules).toEqual([
      { rrule: "FREQ=WEEKLY;BYDAY=SA", confidence: "MEDIUM", notes: undefined },
    ]);
  });

  it("biweekly + specific day → CADENCE sentinel at LOW (no anchor = no projectable dates)", () => {
    const rules = parseFrequencyDay("Biweekly", "Thursday");
    expect(rules).toHaveLength(1);
    expect(rules[0].rrule).toBe("CADENCE=BIWEEKLY;BYDAY=TH");
    expect(rules[0].confidence).toBe("LOW");
    expect(rules[0].notes).toContain("phase alignment unknown");
  });

  it("Bi-Weekly (hyphenated) also produces CADENCE sentinel", () => {
    const rules = parseFrequencyDay("Bi-Weekly", "Saturday");
    expect(rules).toHaveLength(1);
    expect(rules[0].rrule).toBe("CADENCE=BIWEEKLY;BYDAY=SA");
    expect(rules[0].confidence).toBe("LOW");
  });

  it("monthly without an ordinal → CADENCE sentinel at LOW (no specific week)", () => {
    const rules = parseFrequencyDay("Monthly", "Saturday");
    expect(rules).toEqual([
      {
        rrule: "CADENCE=MONTHLY;BYDAY=SA",
        confidence: "LOW",
        notes: "Monthly schedule — specific week unknown, cannot project specific dates",
      },
    ]);
  });

  it("Full Moon → FREQ=LUNAR sentinel with LOW confidence", () => {
    const rules = parseFrequencyDay("Full Moon", null);
    expect(rules).toEqual([
      { rrule: "FREQ=LUNAR", confidence: "LOW", notes: "Full moon schedule" },
    ]);
  });

  it("Biweekly (1st & 3rd Saturdays) → two monthly nth rules", () => {
    const rules = parseFrequencyDay("Biweekly (1st & 3rd Saturdays)", "Saturday");
    expect(rules).toHaveLength(2);
    const rrules = rules.map((r) => r.rrule).sort((a, b) => a.localeCompare(b));
    expect(rrules).toEqual(["FREQ=MONTHLY;BYDAY=1SA", "FREQ=MONTHLY;BYDAY=3SA"]);
    expect(rules.every((r) => r.confidence === "MEDIUM")).toBe(true);
  });

  it("multiple days via slash separator → multiple rules", () => {
    const rules = parseFrequencyDay("Weekly", "Sunday / Monday");
    expect(rules).toHaveLength(2);
    const days = rules.map((r) => r.rrule).sort((a, b) => a.localeCompare(b));
    expect(days).toEqual(["FREQ=WEEKLY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=SU"]);
  });

  it("multiple days via prose in frequency → multiple rules", () => {
    // "Every Wednesday and Saturday." should produce both WE and SA
    const rules = parseFrequencyDay("Every Wednesday and Saturday.", null);
    expect(rules).toHaveLength(2);
    const days = rules.map((r) => r.rrule).sort((a, b) => a.localeCompare(b));
    expect(days).toEqual(["FREQ=WEEKLY;BYDAY=SA", "FREQ=WEEKLY;BYDAY=WE"]);
  });

  it("Weekly (April–October) seasonal variant still parses as WEEKLY", () => {
    const rules = parseFrequencyDay("Weekly (April–October)", "Saturday");
    expect(rules).toHaveLength(1);
    expect(rules[0].rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
  });

  it("Varies day → empty (skipped)", () => {
    const rules = parseFrequencyDay("Weekly", "Varies");
    expect(rules).toEqual([]);
  });

  it("unknown frequency → empty (skipped)", () => {
    expect(parseFrequencyDay("Annual", "Saturday")).toEqual([]);
    expect(parseFrequencyDay("Annually", "Saturday")).toEqual([]);
    expect(parseFrequencyDay("Irregular", "Saturday")).toEqual([]);
    expect(parseFrequencyDay("Multiple", "Saturday")).toEqual([]);
    expect(parseFrequencyDay("Quarterly", "Saturday")).toEqual([]);
    expect(parseFrequencyDay("Twice monthly", "Saturday")).toEqual([]);
    expect(parseFrequencyDay("Bimonthly", "Saturday")).toEqual([]);
  });

  it("empty / null inputs → empty", () => {
    expect(parseFrequencyDay(null, "Saturday")).toEqual([]);
    expect(parseFrequencyDay(undefined, "Saturday")).toEqual([]);
    expect(parseFrequencyDay("", "Saturday")).toEqual([]);
  });

  it("weekly with no day specified and no prose day → empty", () => {
    // If there's no way to pin the day, we can't generate a WEEKLY rule
    expect(parseFrequencyDay("Weekly", null)).toEqual([]);
  });

  it("alternating → treated as biweekly (CADENCE sentinel, LOW)", () => {
    const rules = parseFrequencyDay("alternating", "Thursday");
    expect(rules).toHaveLength(1);
    expect(rules[0].rrule).toBe("CADENCE=BIWEEKLY;BYDAY=TH");
    expect(rules[0].confidence).toBe("LOW");
  });

  it("non-parseable sentinels are clearly distinguishable from valid RRULEs", () => {
    // This test documents the RRULE vs CADENCE convention.
    // The projection engine MUST check confidence before calling parseRRule.
    // CADENCE= and FREQ=LUNAR sentinels will cause parseRRule to throw if
    // accidentally fed to it — this is intentional defense-in-depth.
    const lunar = parseFrequencyDay("Full Moon", null);
    expect(lunar[0].rrule).toBe("FREQ=LUNAR");
    expect(lunar[0].rrule.startsWith("FREQ=WEEKLY")).toBe(false);
    expect(lunar[0].rrule.startsWith("FREQ=MONTHLY")).toBe(false);

    const biweekly = parseFrequencyDay("Biweekly", "Saturday");
    expect(biweekly[0].rrule).toMatch(/^CADENCE=/);
    expect(biweekly[0].confidence).toBe("LOW");

    const monthly = parseFrequencyDay("Monthly", "Saturday");
    expect(monthly[0].rrule).toMatch(/^CADENCE=/);
    expect(monthly[0].confidence).toBe("LOW");

    // Parseable rules use FREQ= prefix and are MEDIUM or HIGH
    const weekly = parseFrequencyDay("Weekly", "Saturday");
    expect(weekly[0].rrule).toMatch(/^FREQ=WEEKLY/);
    expect(weekly[0].confidence).toBe("MEDIUM");

    const nthMonthly = parseFrequencyDay("Biweekly (1st & 3rd Saturdays)", "Saturday");
    expect(nthMonthly[0].rrule).toMatch(/^FREQ=MONTHLY;BYDAY=\d/);
    expect(nthMonthly[0].confidence).toBe("MEDIUM");
  });
});

describe("normalizeRRule", () => {
  it("converts BYSETPOS + BYDAY into nth-BYDAY form", () => {
    expect(normalizeRRule("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1")).toBe("FREQ=MONTHLY;BYDAY=1SA");
    expect(normalizeRRule("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=3")).toBe("FREQ=MONTHLY;BYDAY=3FR");
    expect(normalizeRRule("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=-1")).toBe("FREQ=MONTHLY;BYDAY=-1SA");
  });

  it("leaves RRULE unchanged when no BYSETPOS present", () => {
    expect(normalizeRRule("FREQ=WEEKLY;BYDAY=SA")).toBe("FREQ=WEEKLY;BYDAY=SA");
    expect(normalizeRRule("FREQ=MONTHLY;BYDAY=2SA")).toBe("FREQ=MONTHLY;BYDAY=2SA");
    expect(normalizeRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH");
  });

  it("handles whitespace and case insensitivity", () => {
    expect(normalizeRRule(" freq=monthly ; byday=sa ; bysetpos=1 ")).toBe("FREQ=MONTHLY;BYDAY=1SA");
  });

  it("preserves INTERVAL when present alongside BYSETPOS conversion", () => {
    expect(normalizeRRule("FREQ=MONTHLY;INTERVAL=2;BYDAY=SA;BYSETPOS=1")).toBe("FREQ=MONTHLY;INTERVAL=2;BYDAY=1SA");
  });

  it("does NOT fold BYSETPOS into BYDAY when BYDAY has multiple weekdays", () => {
    // CodeRabbit: BYSETPOS semantics with multi-day BYDAY are ambiguous —
    // "3rd of {Sat, Fri}" vs "3rd Sat AND 3rd Fri." Leave the rule
    // untouched so parseRRule can decide rather than silently producing
    // a wrong fold like BYDAY=3SA,FR.
    expect(normalizeRRule("FREQ=MONTHLY;BYDAY=SA,FR;BYSETPOS=3")).toBe(
      "FREQ=MONTHLY;BYDAY=SA,FR;BYSETPOS=3",
    );
  });
});

// ---------------------------------------------------------------------------
// runStaticSchedulePass — lunar sentinel emission (T2a, PR #1)
// ---------------------------------------------------------------------------

interface FakeKennelLink {
  kennel: { id: string; shortName: string; isHidden: boolean };
}

interface FakeSource {
  id: string;
  name: string;
  url: string | null;
  type: "STATIC_SCHEDULE";
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastScrapeAt: Date | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  kennels: FakeKennelLink[];
}

function fakePrisma(sources: FakeSource[]) {
  return {
    source: {
      findMany: async () => sources,
    },
    // Other methods on PrismaClient are not exercised by runStaticSchedulePass.
  } as unknown as Parameters<typeof runStaticSchedulePass>[0];
}

const FMH3_KENNEL: FakeKennelLink = {
  kennel: { id: "k_sffmh3", shortName: "SFFMH3", isHidden: false },
};
const DCFMH3_KENNEL: FakeKennelLink = {
  kennel: { id: "k_dcfmh3", shortName: "DCFMH3", isHidden: false },
};

describe("runStaticSchedulePass — lunar branch", () => {
  it("emits FREQ=LUNAR sentinel at LOW confidence for exact-mode lunar config", async () => {
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src1",
        name: "SFFMH3 Static Schedule (Lunar)",
        url: "https://www.facebook.com/sffmh",
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "sffmh3",
          lunar: { phase: "full", timezone: "America/Los_Angeles" },
        },
        kennels: [FMH3_KENNEL],
      },
    ]);
    await runStaticSchedulePass(prisma, planned);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      kennelId: "k_sffmh3",
      rrule: "FREQ=LUNAR",
      confidence: "LOW",
    });
    // Notes should mention the phase + timezone for admin context.
    expect(planned[0].notes).toContain("full");
    expect(planned[0].notes).toContain("America/Los_Angeles");
  });

  it("emits FREQ=LUNAR sentinel at LOW confidence for anchor-mode lunar config", async () => {
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src2",
        name: "DCFMH3 Static Schedule (Lunar Anchor)",
        url: "https://sites.google.com/site/dcfmh3/home",
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "dcfmh3",
          lunar: {
            phase: "full",
            timezone: "America/New_York",
            anchorWeekday: "SA",
            anchorRule: "nearest",
          },
        },
        kennels: [DCFMH3_KENNEL],
      },
    ]);
    await runStaticSchedulePass(prisma, planned);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      kennelId: "k_dcfmh3",
      rrule: "FREQ=LUNAR",
      confidence: "LOW",
    });
    expect(planned[0].notes).toContain("anchored");
    expect(planned[0].notes).toContain("SA");
    expect(planned[0].notes).toContain("nearest");
  });

  it("skips lunar config with missing or invalid phase", async () => {
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src3",
        name: "Bogus Lunar",
        url: null,
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "bogus",
          lunar: { phase: "quarter", timezone: "UTC" }, // invalid phase
        },
        kennels: [{ kennel: { id: "k_bogus", shortName: "BOGUS", isHidden: false } }],
      },
    ]);
    const result = await runStaticSchedulePass(prisma, planned);
    expect(planned).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("skips lunar config missing timezone (matches adapter rejection)", async () => {
    // Codex pass-2 finding: backfill must reject configs the adapter rejects,
    // otherwise Travel Mode shows possible-activity rules for sources that
    // produce zero canonical events.
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src5",
        name: "Lunar without timezone",
        url: null,
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "no-tz",
          lunar: { phase: "full" }, // missing timezone
        },
        kennels: [{ kennel: { id: "k_notz", shortName: "NOTZ", isHidden: false } }],
      },
    ]);
    const result = await runStaticSchedulePass(prisma, planned);
    expect(planned).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("skips lunar config with partial anchor pair (matches adapter rejection)", async () => {
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src6",
        name: "Lunar with anchorWeekday but no anchorRule",
        url: null,
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "partial-anchor",
          lunar: { phase: "full", timezone: "UTC", anchorWeekday: "SA" },
        },
        kennels: [{ kennel: { id: "k_partial", shortName: "PARTIAL", isHidden: false } }],
      },
    ]);
    const result = await runStaticSchedulePass(prisma, planned);
    expect(planned).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("skips dual-config rows where both rrule and lunar are set (Codex pass-4: XOR enforcement)", async () => {
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src-dual",
        name: "Dual-config (XOR violation)",
        url: null,
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "dual",
          rrule: "FREQ=WEEKLY;BYDAY=SA",
          lunar: { phase: "full", timezone: "America/Los_Angeles" },
        },
        kennels: [{ kennel: { id: "k_dual", shortName: "DUAL", isHidden: false } }],
      },
    ]);
    const result = await runStaticSchedulePass(prisma, planned);
    // Adapter rejects dual-config; backfill must too — otherwise Travel Mode
    // would project a HIGH-confidence rule for a source that never materializes.
    expect(planned).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("does not regress rrule-mode handling (existing GSH3-shape source still HIGH confidence)", async () => {
    const planned: Parameters<typeof runStaticSchedulePass>[1] = [];
    const prisma = fakePrisma([
      {
        id: "src4",
        name: "Grand Strand H3 Static Schedule",
        url: "https://www.facebook.com/GrandStrandHashing/",
        type: "STATIC_SCHEDULE",
        enabled: true,
        lastSuccessAt: null,
        lastScrapeAt: null,
        config: {
          kennelTag: "gsh3",
          rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
          anchorDate: "2026-03-07",
        },
        kennels: [{ kennel: { id: "k_gsh3", shortName: "GSH3", isHidden: false } }],
      },
    ]);
    await runStaticSchedulePass(prisma, planned);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      anchorDate: "2026-03-07",
      confidence: "HIGH",
    });
  });
});

// ---------------------------------------------------------------------------
// runKennelSeedPass — Pass 3, multi-cadence seed rules (#1390)
// ---------------------------------------------------------------------------

interface FakeKennelRow {
  id: string;
  kennelCode: string;
  shortName: string;
}

/**
 * Minimal prisma stub for Pass 3 — only `kennel.findMany` is exercised. Returns
 * rows whose kennelCode is in the `where.kennelCode.in` clause.
 */
function fakePrismaForSeed(kennels: FakeKennelRow[]) {
  return {
    kennel: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async (args: any) => {
        const codes: string[] = args?.where?.kennelCode?.in ?? [];
        return kennels.filter((k) => codes.includes(k.kennelCode));
      },
    },
  } as unknown as Parameters<typeof runKennelSeedPass>[0];
}

describe("runKennelSeedPass", () => {
  it("emits one HIGH-confidence rule per scheduleRules entry, threading label/validFrom/validUntil/displayOrder", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([
      { id: "k_hockessin", kennelCode: "hockessin", shortName: "Hockessin H3" },
    ]);
    const seeds = [
      {
        kennelCode: "hockessin",
        scheduleRules: [
          {
            rrule: "FREQ=WEEKLY;BYDAY=WE",
            startTime: "18:30",
            label: "Summer",
            validFrom: "03-01",
            validUntil: "10-31",
            displayOrder: 0,
          },
          {
            rrule: "FREQ=WEEKLY;BYDAY=SA",
            startTime: "15:00",
            label: "Winter",
            validFrom: "11-01",
            validUntil: "02-28",
            displayOrder: 1,
          },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    const result = await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(result.count).toBe(2);
    expect(result.skippedKennels).toBe(0);
    expect(result.skippedRules).toBe(0);

    expect(planned).toHaveLength(2);
    expect(planned[0]).toMatchObject({
      kennelId: "k_hockessin",
      rrule: "FREQ=WEEKLY;BYDAY=WE",
      startTime: "18:30",
      confidence: "HIGH",
      source: "SEED_DATA",
      sourceReference: "KennelSeed.scheduleRules[hockessin]",
      label: "Summer",
      validFrom: "03-01",
      validUntil: "10-31",
      displayOrder: 0,
    });
    expect(planned[0].lastValidatedAt).toBeInstanceOf(Date);
    expect(planned[1]).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      label: "Winter",
      validFrom: "11-01",
      validUntil: "02-28",
      displayOrder: 1,
    });
  });

  it("emits #1723 same-weekday seasonal rules as distinct BYMONTH rrules (no unique-key collision)", async () => {
    // chh3 runs 2nd & 4th Saturday year-round but 4 PM summer / 2 PM winter. The naive
    // encoding (same rrule, two startTimes) would collide on (kennelId, rrule, source);
    // disjoint BYMONTH keeps the four rrules distinct while each carries its own startTime.
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([{ id: "k_chh3", kennelCode: "chh3", shortName: "CHH3" }]);
    const seeds = [
      {
        kennelCode: "chh3",
        scheduleRules: [
          { rrule: "FREQ=MONTHLY;BYDAY=2SA;BYMONTH=6,7,8", startTime: "16:00", label: "Summer (Jun–Aug)", displayOrder: 0 },
          { rrule: "FREQ=MONTHLY;BYDAY=4SA;BYMONTH=6,7,8", startTime: "16:00", label: "Summer (Jun–Aug)", displayOrder: 1 },
          { rrule: "FREQ=MONTHLY;BYDAY=2SA;BYMONTH=1,2,3,4,5,9,10,11,12", startTime: "14:00", label: "Winter (Sep–May)", displayOrder: 2 },
          { rrule: "FREQ=MONTHLY;BYDAY=4SA;BYMONTH=1,2,3,4,5,9,10,11,12", startTime: "14:00", label: "Winter (Sep–May)", displayOrder: 3 },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    const result = await runKennelSeedPass(prisma, planned, {}, seeds);

    // All four validate + emit — the BYMONTH rrules pass seed validation.
    expect(result.count).toBe(4);
    expect(result.skippedRules).toBe(0);
    // The 2SA-summer/2SA-winter (and 4SA) pairs must normalize to DISTINCT rrules so
    // they don't overwrite each other on the (kennelId, rrule, source) upsert key.
    expect(new Set(planned.map((r) => r.rrule)).size).toBe(4);
    // Per-rule startTime threads through: summer 16:00, winter 14:00.
    const summer = planned.filter((r) => r.rrule.includes("BYMONTH=6,7,8"));
    const winter = planned.filter((r) => !r.rrule.includes("BYMONTH=6,7,8"));
    expect(summer.map((r) => r.startTime)).toEqual(["16:00", "16:00"]);
    expect(winter.map((r) => r.startTime)).toEqual(["14:00", "14:00"]);
  });

  it("emits one rule per Hebe-style single-slot seed (no seasonality metadata)", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([
      { id: "k_hebe", kennelCode: "hebe-h3", shortName: "Hebe H3" },
    ]);
    const seeds = [
      {
        kennelCode: "hebe-h3",
        scheduleRules: [
          { rrule: "FREQ=MONTHLY;BYDAY=1SA", startTime: "15:00", label: "Monthly" },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      rrule: "FREQ=MONTHLY;BYDAY=1SA",
      confidence: "HIGH",
      source: "SEED_DATA",
      label: "Monthly",
      validFrom: null,
      validUntil: null,
      displayOrder: 0,
    });
  });

  it("drops malformed MM-DD anchors with a warning instead of writing garbage", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([
      { id: "k_x", kennelCode: "x", shortName: "X" },
    ]);
    const seeds = [
      {
        kennelCode: "x",
        scheduleRules: [
          {
            rrule: "FREQ=WEEKLY;BYDAY=MO",
            // Invalid: month 13 (validates against 1-12 and last-day-of-month).
            validFrom: "13-01",
            validUntil: "02-30",
          },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(planned).toHaveLength(1);
    expect(planned[0].validFrom).toBeNull();
    expect(planned[0].validUntil).toBeNull();
  });

  it("accepts Feb 29 (leap-year-aware date validation)", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([
      { id: "k_x", kennelCode: "x", shortName: "X" },
    ]);
    const seeds = [
      {
        kennelCode: "x",
        scheduleRules: [
          { rrule: "FREQ=WEEKLY;BYDAY=SA", validUntil: "02-29" },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(planned[0].validUntil).toBe("02-29");
  });

  it("skips kennels missing from the DB (e.g. hidden / deleted) without crashing", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([]); // empty DB
    const seeds = [
      {
        kennelCode: "ghost",
        scheduleRules: [{ rrule: "FREQ=WEEKLY;BYDAY=SA" }] satisfies KennelScheduleRuleSeed[],
      },
    ];
    const result = await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(planned).toHaveLength(0);
    expect(result.skippedKennels).toBe(1);
  });

  it("skips rule entries with empty rrule (defensive guard against seed typos)", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([
      { id: "k_y", kennelCode: "y", shortName: "Y" },
    ]);
    const seeds = [
      {
        kennelCode: "y",
        scheduleRules: [
          { rrule: "" },
          { rrule: "   " },
          { rrule: "FREQ=WEEKLY;BYDAY=SU" },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    const result = await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(result.count).toBe(1);
    expect(result.skippedRules).toBe(2);
    expect(planned[0].rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
  });

  it("skips rule entries whose RRULE doesn't parse (fail-loud on malformed seed input)", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    const prisma = fakePrismaForSeed([
      { id: "k_z", kennelCode: "z", shortName: "Z" },
    ]);
    const seeds = [
      {
        kennelCode: "z",
        scheduleRules: [
          { rrule: "FREQ=YEARLY" }, // unsupported FREQ — parseRRule throws
          { rrule: "FREQ=WEEKLY" }, // WEEKLY without BYDAY — parseRRule throws
          { rrule: "FREQ=WEEKLY;BYDAY=SA" }, // valid
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    const result = await runKennelSeedPass(prisma, planned, {}, seeds);
    expect(result.count).toBe(1);
    expect(result.skippedRules).toBe(2);
    expect(planned[0].rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
  });

  it("returns immediately when no kennel carries scheduleRules (isolation from passes 1 + 2)", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [];
    // Seed pre-populated with a Pass 1-shaped rule to confirm Pass 3 leaves
    // existing planned entries untouched when there's nothing to add.
    planned.push({
      kennelId: "k_other",
      kennelDisplay: "OTHER",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      anchorDate: null,
      startTime: null,
      confidence: "HIGH",
      source: "STATIC_SCHEDULE",
      sourceReference: "https://example.test/x",
      lastValidatedAt: null,
      notes: null,
      label: null,
      validFrom: null,
      validUntil: null,
      displayOrder: 0,
    });
    const prisma = fakePrismaForSeed([]);
    const result = await runKennelSeedPass(prisma, planned, {}, []);
    expect(result).toEqual({ count: 0, skippedKennels: 0, skippedRules: 0 });
    expect(planned).toHaveLength(1); // unchanged
  });

  // #1492: when Pass 1 already emitted a HIGH STATIC_SCHEDULE row for the same
  // (kennelId, rrule), Pass 3 must absorb it — keep the SEED_DATA row (richer
  // metadata), drop the STATIC_SCHEDULE row so `deactivateStaleRules` flips
  // its DB row inactive. Hebe H3 is the production reproduction: both passes
  // emit `(hebe-h3, FREQ=MONTHLY;BYDAY=1SA, 15:00)`; only the Pass 3 row
  // carries label="Monthly".
  it("(#1492) absorbs an overlapping Pass 1 STATIC_SCHEDULE row, surviving with richer Pass 3 metadata", async () => {
    const pass1ValidatedAt = new Date("2026-05-01T00:00:00Z");
    const planned: Parameters<typeof runKennelSeedPass>[1] = [
      {
        kennelId: "k_hebe",
        kennelDisplay: "Hebe H3",
        rrule: "FREQ=MONTHLY;BYDAY=1SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: "https://www.facebook.com/hebehash",
        lastValidatedAt: pass1ValidatedAt,
        notes: null,
        label: null, // Pass 1 doesn't know the label
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const prisma = fakePrismaForSeed([
      { id: "k_hebe", kennelCode: "hebe-h3", shortName: "Hebe H3" },
    ]);
    const seeds = [
      {
        kennelCode: "hebe-h3",
        scheduleRules: [
          { rrule: "FREQ=MONTHLY;BYDAY=1SA", startTime: "15:00", label: "Monthly" },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);

    // Exactly one survivor: the Pass 3 SEED_DATA row with absorbsStaticSchedule set.
    expect(planned).toHaveLength(1);
    const [survivor] = planned;
    expect(survivor).toMatchObject({
      kennelId: "k_hebe",
      rrule: "FREQ=MONTHLY;BYDAY=1SA",
      startTime: "15:00",
      confidence: "HIGH",
      source: "SEED_DATA",
      label: "Monthly", // Pass 3 metadata preserved
      absorbsStaticSchedule: true,
    });
    // Pass 1's scrape moment carries over so the surviving row keeps tracking
    // validation freshness (see applyUpserts + travel scoreProjections).
    expect(survivor.lastValidatedAt).toBe(pass1ValidatedAt);
  });

  // #1492 enrichment: Pass 3 inherits null fields from the absorbed Pass 1 row.
  // A seed that omits startTime should still surface the Pass 1 source config's
  // startTime, mirroring the Pass 1 ↔ Pass 2 enrichment behavior added in #1491.
  it("(#1492) inherits Pass 1's startTime + anchorDate when the Pass 3 seed left them null", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [
      {
        kennelId: "k_x",
        kennelDisplay: "X",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        anchorDate: "2026-01-05",
        startTime: "18:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: "https://example.test/x",
        lastValidatedAt: new Date(),
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const prisma = fakePrismaForSeed([{ id: "k_x", kennelCode: "x", shortName: "X" }]);
    const seeds = [
      {
        kennelCode: "x",
        scheduleRules: [
          { rrule: "FREQ=WEEKLY;BYDAY=MO", label: "Monday" }, // no startTime / anchorDate
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      source: "SEED_DATA",
      startTime: "18:00", // inherited from Pass 1
      anchorDate: "2026-01-05", // inherited from Pass 1
      label: "Monday", // Pass 3 metadata preserved
      absorbsStaticSchedule: true,
    });
  });

  // #1492 over-fire guard: an unrelated Pass 1 row (different kennel OR
  // different rrule) is left alone. Only matching (kennelId, rrule) collide.
  it("(#1492) leaves unrelated Pass 1 rows alone (different kennel)", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [
      {
        kennelId: "k_other",
        kennelDisplay: "Other",
        rrule: "FREQ=MONTHLY;BYDAY=1SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: "https://example.test/other",
        lastValidatedAt: new Date(),
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const prisma = fakePrismaForSeed([
      { id: "k_hebe", kennelCode: "hebe-h3", shortName: "Hebe H3" },
    ]);
    const seeds = [
      {
        kennelCode: "hebe-h3",
        scheduleRules: [
          { rrule: "FREQ=MONTHLY;BYDAY=1SA", startTime: "15:00", label: "Monthly" },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);

    // Other kennel's Pass 1 row untouched; Hebe gets its Pass 3 row.
    expect(planned).toHaveLength(2);
    const other = planned.find((p) => p.kennelId === "k_other");
    expect(other?.source).toBe("STATIC_SCHEDULE");
    expect(other?.absorbsStaticSchedule).toBeUndefined();
    const hebe = planned.find((p) => p.kennelId === "k_hebe");
    expect(hebe?.source).toBe("SEED_DATA");
    expect(hebe?.absorbsStaticSchedule).toBeUndefined(); // no Pass 1 to absorb
  });

  // #1492 Codex HIGH: when Pass 1's lastValidatedAt is null (scrape never
  // succeeded — `Source.lastSuccessAt ?? lastScrapeAt ?? null`), the absorbed
  // Pass 3 row must NOT inherit scrape-validated semantics. Otherwise the
  // synthetic `new Date()` default from `planSeedRule` would be bumped on
  // every `applyUpserts` run, claiming "freshly validated" for a rule no
  // scrape has ever confirmed.
  it("(#1492 Codex HIGH) does NOT claim scrape validation when Pass 1's lastValidatedAt is null", async () => {
    const planned: Parameters<typeof runKennelSeedPass>[1] = [
      {
        kennelId: "k_hebe",
        kennelDisplay: "Hebe H3",
        rrule: "FREQ=MONTHLY;BYDAY=1SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: "https://www.facebook.com/hebehash",
        lastValidatedAt: null, // scrape never succeeded
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const prisma = fakePrismaForSeed([
      { id: "k_hebe", kennelCode: "hebe-h3", shortName: "Hebe H3" },
    ]);
    const seeds = [
      {
        kennelCode: "hebe-h3",
        scheduleRules: [
          { rrule: "FREQ=MONTHLY;BYDAY=1SA", startTime: "15:00", label: "Monthly" },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);

    // Pass 1 still spliced (Pass 3 wins identity), but absorbsStaticSchedule
    // stays unset so applyUpserts keeps the standard SEED_DATA behavior
    // (first-create timestamp, no bump).
    expect(planned).toHaveLength(1);
    expect(planned[0].source).toBe("SEED_DATA");
    expect(planned[0].absorbsStaticSchedule).toBeUndefined();
  });

  // #1492 Codex HIGH: when Pass 1 and Pass 3 disagree on startTime (e.g. seed
  // author overrode the source config), Pass 3 wins on identity but must NOT
  // inherit Pass 1's lastValidatedAt — that timestamp was earned by a DIFFERENT
  // shape (the Pass 1 startTime) and would mislead travel scoring into trusting
  // the new shape as scrape-validated when it hasn't been.
  it("(#1492 Codex HIGH) does NOT claim scrape validation when startTime conflicts", async () => {
    const pass1ValidatedAt = new Date("2026-05-01T00:00:00Z");
    const planned: Parameters<typeof runKennelSeedPass>[1] = [
      {
        kennelId: "k_x",
        kennelDisplay: "X",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        anchorDate: null,
        startTime: "18:00", // scrape says 18:00
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: "https://example.test/x",
        lastValidatedAt: pass1ValidatedAt,
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const prisma = fakePrismaForSeed([{ id: "k_x", kennelCode: "x", shortName: "X" }]);
    const seeds = [
      {
        kennelCode: "x",
        scheduleRules: [
          { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "19:00", label: "Monday" }, // seed says 19:00
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);

    expect(planned).toHaveLength(1);
    const survivor = planned[0];
    expect(survivor.startTime).toBe("19:00"); // Pass 3 wins identity
    expect(survivor.absorbsStaticSchedule).toBeUndefined(); // but no scrape inheritance
    expect(survivor.lastValidatedAt).not.toBe(pass1ValidatedAt);
  });

  // #1492 Codex HIGH: anchorDate conflict — same gate as startTime, separate
  // test so a future regression that only checks one field surfaces explicitly.
  it("(#1492 Codex HIGH) does NOT claim scrape validation when anchorDate conflicts", async () => {
    const pass1ValidatedAt = new Date("2026-05-01T00:00:00Z");
    const planned: Parameters<typeof runKennelSeedPass>[1] = [
      {
        kennelId: "k_x",
        kennelDisplay: "X",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
        anchorDate: "2026-01-05", // scrape says Jan 5
        startTime: "18:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: "https://example.test/x",
        lastValidatedAt: pass1ValidatedAt,
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const prisma = fakePrismaForSeed([{ id: "k_x", kennelCode: "x", shortName: "X" }]);
    const seeds = [
      {
        kennelCode: "x",
        scheduleRules: [
          {
            rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
            anchorDate: "2026-01-12", // seed says Jan 12 (different)
            startTime: "18:00",
          },
        ] satisfies KennelScheduleRuleSeed[],
      },
    ];
    await runKennelSeedPass(prisma, planned, {}, seeds);

    expect(planned).toHaveLength(1);
    const survivor = planned[0];
    expect(survivor.anchorDate).toBe("2026-01-12");
    expect(survivor.absorbsStaticSchedule).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runKennelDisplayPass — Pass 2 opt-out for kennels that declare scheduleRules
// ---------------------------------------------------------------------------

interface FakeKennelDisplayRow {
  id: string;
  kennelCode: string;
  shortName: string;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  scheduleNotes: string | null;
}

function fakePrismaForDisplay(kennels: FakeKennelDisplayRow[]) {
  return {
    kennel: {
      findMany: async () => kennels,
    },
  } as unknown as Parameters<typeof runKennelDisplayPass>[0];
}

describe("runKennelDisplayPass — Pass 3 opt-out", () => {
  const FAKE_KENNELS: FakeKennelDisplayRow[] = [
    {
      id: "k_legacy",
      kennelCode: "legacy",
      shortName: "Legacy",
      scheduleDayOfWeek: "Saturday",
      scheduleTime: "3:00 PM",
      scheduleFrequency: "Weekly",
      scheduleNotes: null,
    },
    {
      id: "k_migrated",
      kennelCode: "migrated",
      shortName: "Migrated",
      scheduleDayOfWeek: "Saturday",
      scheduleTime: "3:00 PM",
      scheduleFrequency: "Weekly",
      scheduleNotes: null,
    },
  ];

  it.each<{
    label: string;
    seeds: Array<{ kennelCode: string; scheduleRules?: KennelScheduleRuleSeed[] }>;
    expectedCount: number;
    expectedOptedOut: number;
    expectedKennelIds: string[];
  }>([
    {
      label: "skips kennels whose seed declares non-empty scheduleRules",
      seeds: [
        { kennelCode: "legacy" },
        { kennelCode: "migrated", scheduleRules: [{ rrule: "FREQ=WEEKLY;BYDAY=SA" }] },
      ],
      expectedCount: 1,
      expectedOptedOut: 1,
      expectedKennelIds: ["k_legacy"],
    },
    {
      label: "does NOT opt out when scheduleRules is an empty array",
      seeds: [
        { kennelCode: "legacy", scheduleRules: [] },
        { kennelCode: "migrated" },
      ],
      expectedCount: 2,
      expectedOptedOut: 0,
      expectedKennelIds: ["k_legacy", "k_migrated"],
    },
    {
      label: "processes all kennels when no seed list is provided (empty injection)",
      seeds: [],
      expectedCount: 2,
      expectedOptedOut: 0,
      expectedKennelIds: ["k_legacy", "k_migrated"],
    },
  ])("$label", async ({ seeds, expectedCount, expectedOptedOut, expectedKennelIds }) => {
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [];
    const result = await runKennelDisplayPass(
      fakePrismaForDisplay(FAKE_KENNELS),
      planned,
      {},
      seeds,
    );
    expect(result.count).toBe(expectedCount);
    expect(result.optedOut).toBe(expectedOptedOut);
    expect(planned.map((p) => p.kennelId)).toEqual(expectedKennelIds);
  });

  // #1486: Pass 2 must not emit a SEED_DATA rule when an earlier pass already
  // produced a HIGH-confidence rule for the same (kennelId, rrule). Without
  // this guard, the @@unique constraint on (kennelId, rrule, source) lets both
  // rows survive (different `source` enums) and the UI renders them as
  // duplicate "Mondays at 6:00 PM / Mondays at 6:00 PM" via formatScheduleRules
  // (the HHHS symptom in #1475).
  it("skips Pass 2 emit when Pass 1 already covers (kennelId, rrule)", async () => {
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [
      {
        // Simulates the Pass 1 emit for the same kennel + RRULE that Pass 2
        // would otherwise produce. `legacy`'s display strings parse to
        // FREQ=WEEKLY;BYDAY=SA (Saturday + Weekly).
        kennelId: "k_legacy",
        kennelDisplay: "Legacy",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: null,
        lastValidatedAt: new Date(),
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const result = await runKennelDisplayPass(
      fakePrismaForDisplay(FAKE_KENNELS),
      planned,
      {},
      [],
    );

    // legacy is covered by the pre-existing Pass 1 rule → no new emit.
    // migrated is unchanged → still emits one MEDIUM SEED_DATA rule.
    expect(result.count).toBe(1);
    expect(result.coveredByEarlierPass).toBe(1);
    expect(planned).toHaveLength(2);
    const legacyRules = planned.filter((p) => p.kennelId === "k_legacy");
    expect(legacyRules).toHaveLength(1);
    expect(legacyRules[0].source).toBe("STATIC_SCHEDULE");
    const migratedRules = planned.filter((p) => p.kennelId === "k_migrated");
    expect(migratedRules).toHaveLength(1);
    expect(migratedRules[0].source).toBe("SEED_DATA");
  });

  // Codex P2 on PR #1491: if Pass 1's HIGH rule has a null startTime but Pass 2's
  // parsed display string would have supplied one (Kennel.scheduleTime is set),
  // mutate the covered Pass 1 entry to carry the Pass 2 startTime before skipping.
  // Without this, kennels with a STATIC_SCHEDULE source config that omits
  // `startTime` would lose the time-of-day inferred from the flat fields.
  it("enriches the covered Pass 1 rule's null startTime from Pass 2's parsed value", async () => {
    const pass1Rule: Parameters<typeof runKennelDisplayPass>[1][number] = {
      kennelId: "k_legacy",
      kennelDisplay: "Legacy",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: null,
      startTime: null, // Pass 1 source config omitted startTime
      confidence: "HIGH",
      source: "STATIC_SCHEDULE",
      sourceReference: null,
      lastValidatedAt: new Date(),
      notes: null,
      label: null,
      validFrom: null,
      validUntil: null,
      displayOrder: 0,
    };
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [pass1Rule];
    const result = await runKennelDisplayPass(
      fakePrismaForDisplay(FAKE_KENNELS),
      planned,
      {},
      [],
    );

    // legacy was covered → no SEED_DATA emit, but its Pass 1 row gained 15:00
    // from the flat-field parse (FAKE_KENNELS sets scheduleTime: "3:00 PM").
    expect(result.coveredByEarlierPass).toBe(1);
    expect(pass1Rule.startTime).toBe("15:00");
    // migrated still emits normally
    expect(planned).toHaveLength(2);
    const migratedRules = planned.filter((p) => p.kennelId === "k_migrated");
    expect(migratedRules).toHaveLength(1);
    expect(migratedRules[0].source).toBe("SEED_DATA");
  });

  // Pass 1's non-null startTime is authoritative — flat-field divergence is
  // usually stale data. Do NOT overwrite an existing startTime on the covered rule.
  it("preserves Pass 1's non-null startTime even when Pass 2 parses a different value", async () => {
    const pass1Rule: Parameters<typeof runKennelDisplayPass>[1][number] = {
      kennelId: "k_legacy",
      kennelDisplay: "Legacy",
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: null,
      startTime: "14:00", // STATIC_SCHEDULE source config explicitly says 2 PM
      confidence: "HIGH",
      source: "STATIC_SCHEDULE",
      sourceReference: null,
      lastValidatedAt: new Date(),
      notes: null,
      label: null,
      validFrom: null,
      validUntil: null,
      displayOrder: 0,
    };
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [pass1Rule];
    await runKennelDisplayPass(fakePrismaForDisplay(FAKE_KENNELS), planned, {}, []);

    // FAKE_KENNELS' flat field says "3:00 PM" → 15:00 — but Pass 1's 14:00 wins.
    expect(pass1Rule.startTime).toBe("14:00");
  });

  // CodeRabbit on PR #1491: only STATIC_SCHEDULE / HIGH rules block Pass 2.
  // A HIGH SEED_DATA rule (e.g. a pre-loaded Pass 3 entry, or a future
  // reordering of passes) must NOT suppress the Pass 2 emit — the dedup
  // intent is precisely the Pass 1 ↔ Pass 2 collision.
  it("does NOT skip Pass 2 emit when the HIGH rule is from a non-Pass-1 source", async () => {
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [
      {
        kennelId: "k_legacy",
        kennelDisplay: "Legacy",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "HIGH",
        source: "SEED_DATA", // not STATIC_SCHEDULE — should NOT block Pass 2
        sourceReference: null,
        lastValidatedAt: null,
        notes: null,
        label: "Monthly",
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const result = await runKennelDisplayPass(
      fakePrismaForDisplay(FAKE_KENNELS),
      planned,
      {},
      [],
    );

    // Both kennels emit normally; nothing was treated as covered.
    expect(result.count).toBe(2);
    expect(result.coveredByEarlierPass).toBe(0);
    expect(planned).toHaveLength(3);
  });

  // CodeRabbit on PR #1491: `coveredByEarlierPass` must count individual
  // covered rules, not whole kennels. A kennel with parsed.length === 2
  // where 1 rule is covered and 1 emits should contribute to BOTH counters.
  it("counts covered rules per-rule, not per-kennel (mixed-case kennel)", async () => {
    // "Biweekly (1st & 3rd Saturdays)" parses to two monthly nth rules
    // (FREQ=MONTHLY;BYDAY=1SA and FREQ=MONTHLY;BYDAY=3SA). Pre-populate Pass 1
    // with a STATIC_SCHEDULE rule covering only the first; the second should
    // still emit, and `result.coveredByEarlierPass` should report 1.
    const MIXED_KENNEL: FakeKennelDisplayRow = {
      id: "k_mixed",
      kennelCode: "mixed",
      shortName: "Mixed",
      scheduleDayOfWeek: "Saturday",
      scheduleTime: "3:00 PM",
      scheduleFrequency: "Biweekly (1st & 3rd Saturdays)",
      scheduleNotes: null,
    };
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [
      {
        kennelId: "k_mixed",
        kennelDisplay: "Mixed",
        rrule: "FREQ=MONTHLY;BYDAY=1SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: null,
        lastValidatedAt: new Date(),
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const result = await runKennelDisplayPass(
      fakePrismaForDisplay([MIXED_KENNEL]),
      planned,
      {},
      [],
    );

    // 1 rule covered (1SA), 1 rule emitted (3SA).
    expect(result.count).toBe(1);
    expect(result.coveredByEarlierPass).toBe(1);
    const newSeedRules = planned.filter((p) => p.source === "SEED_DATA");
    expect(newSeedRules).toHaveLength(1);
    expect(newSeedRules[0].rrule).toBe("FREQ=MONTHLY;BYDAY=3SA");
  });

  // Only HIGH-confidence rules in `planned` block Pass 2 — a MEDIUM rule
  // sitting in `planned` (e.g. from a prior Pass 2 run in the same process)
  // must NOT block re-emission. This keeps the guard precise to the
  // Pass-1-vs-Pass-2 collision and avoids breaking idempotent re-invocation.
  it("does NOT skip Pass 2 emit when only a MEDIUM-confidence rule exists", async () => {
    const planned: Parameters<typeof runKennelDisplayPass>[1] = [
      {
        kennelId: "k_legacy",
        kennelDisplay: "Legacy",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        anchorDate: null,
        startTime: "15:00",
        confidence: "MEDIUM",
        source: "SEED_DATA",
        sourceReference: null,
        lastValidatedAt: null,
        notes: null,
        label: null,
        validFrom: null,
        validUntil: null,
        displayOrder: 0,
      },
    ];
    const result = await runKennelDisplayPass(
      fakePrismaForDisplay(FAKE_KENNELS),
      planned,
      {},
      [],
    );

    expect(result.count).toBe(2);
    expect(result.coveredByEarlierPass).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyUpserts — lastValidatedAt is bumped for STATIC_SCHEDULE only
// ---------------------------------------------------------------------------
//
// Codex P2 + Gemini + Claude review on PR #1405 flagged that the original
// applyUpserts UPDATE clause unconditionally included `lastValidatedAt`, which
// meant every backfill re-run overwrote admin-set timestamps and Pass 3's
// "first seed-validation moment" with `new Date()` or null. The fix: only
// include `lastValidatedAt` in UPDATE for STATIC_SCHEDULE rules (where the
// scrape's lastSuccessAt IS the validation moment). Lock the contract here.

function makePlannedRuleForUpsert(overrides: {
  source: "STATIC_SCHEDULE" | "SEED_DATA";
  lastValidatedAt: Date | null;
}) {
  return {
    kennelId: "k_x",
    kennelDisplay: "X",
    rrule: "FREQ=WEEKLY;BYDAY=SA",
    anchorDate: null,
    startTime: null,
    confidence: "HIGH" as const,
    source: overrides.source,
    sourceReference: null,
    lastValidatedAt: overrides.lastValidatedAt,
    notes: null,
    label: null,
    validFrom: null,
    validUntil: null,
    displayOrder: 0,
  };
}

function makeSpyingPrismaForUpsert() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upsertCalls: any[] = [];
  return {
    prisma: {
      scheduleRule: {
        findMany: async () => [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: async (args: any) => {
          upsertCalls.push(args);
          return { id: `id_${upsertCalls.length}` };
        },
      },
    } as unknown as Parameters<typeof applyUpserts>[0],
    upsertCalls,
  };
}

describe("applyUpserts — lastValidatedAt update semantics", () => {
  it("INCLUDES lastValidatedAt in update clause for STATIC_SCHEDULE rules", async () => {
    const { prisma, upsertCalls } = makeSpyingPrismaForUpsert();
    const validatedAt = new Date("2026-05-01T00:00:00Z");
    await applyUpserts(prisma, [
      makePlannedRuleForUpsert({ source: "STATIC_SCHEDULE", lastValidatedAt: validatedAt }),
    ]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].update).toHaveProperty("lastValidatedAt", validatedAt);
    // Create always carries it
    expect(upsertCalls[0].create.lastValidatedAt).toEqual(validatedAt);
  });

  it("EXCLUDES lastValidatedAt from update clause for SEED_DATA rules (preserves admin timestamps)", async () => {
    const { prisma, upsertCalls } = makeSpyingPrismaForUpsert();
    await applyUpserts(prisma, [
      makePlannedRuleForUpsert({ source: "SEED_DATA", lastValidatedAt: new Date() }),
    ]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].update).not.toHaveProperty("lastValidatedAt");
    // Create always carries it — first-seen moment is recorded.
    expect(upsertCalls[0].create).toHaveProperty("lastValidatedAt");
  });

  // #1492: a SEED_DATA rule that absorbed an overlapping Pass 1 STATIC_SCHEDULE
  // row inherits Pass 1's scrape-validated semantics — the Pass 1 DB row is
  // being deactivated, so the surviving Pass 3 row must keep bumping
  // lastValidatedAt or travel projections lose their "actively validated"
  // signal (see lib/travel/search.ts scoreProjections).
  it("(#1492) INCLUDES lastValidatedAt in update for SEED_DATA rules with absorbsStaticSchedule", async () => {
    const { prisma, upsertCalls } = makeSpyingPrismaForUpsert();
    const validatedAt = new Date("2026-05-01T00:00:00Z");
    await applyUpserts(prisma, [
      { ...makePlannedRuleForUpsert({ source: "SEED_DATA", lastValidatedAt: validatedAt }), absorbsStaticSchedule: true },
    ]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].update).toHaveProperty("lastValidatedAt", validatedAt);
  });
});

describe("planSeedRule — per-rule confidence + CADENCE sentinels", () => {
  const dbKennel = { id: "k1", kennelCode: "dh3-ae", shortName: "Desert H3" };

  it("accepts a CADENCE=WEEKLY sentinel verbatim at LOW (never fed to parseRRule)", () => {
    const planned: Parameters<typeof planSeedRule>[3] = [];
    const result = planSeedRule(
      { rrule: "CADENCE=WEEKLY;BYDAY=SU", confidence: "LOW", label: "Sunday afternoon" },
      dbKennel,
      "dh3-ae",
      planned,
      {},
    );
    expect(result).toBe("emitted");
    expect(planned).toHaveLength(1);
    expect(planned[0].rrule).toBe("CADENCE=WEEKLY;BYDAY=SU");
    expect(planned[0].confidence).toBe("LOW");
  });

  it("honors an explicit MEDIUM confidence on a parseable rule", () => {
    const planned: Parameters<typeof planSeedRule>[3] = [];
    planSeedRule(
      { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "19:00", confidence: "MEDIUM" },
      dbKennel,
      "dh3-ae",
      planned,
      {},
    );
    expect(planned[0].rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(planned[0].confidence).toBe("MEDIUM");
  });

  it("defaults a parseable rule to HIGH when confidence is omitted", () => {
    const planned: Parameters<typeof planSeedRule>[3] = [];
    planSeedRule({ rrule: "FREQ=WEEKLY;BYDAY=MO" }, dbKennel, "dh3-ae", planned, {});
    expect(planned[0].confidence).toBe("HIGH");
  });

  it("forces LOW on a sentinel even if a non-LOW confidence is declared", () => {
    const planned: Parameters<typeof planSeedRule>[3] = [];
    planSeedRule(
      { rrule: "CADENCE=MONTHLY;BYDAY=SA", confidence: "HIGH" },
      dbKennel,
      "dh3-ae",
      planned,
      {},
    );
    expect(planned[0].confidence).toBe("LOW");
  });

  it("rejects an UNKNOWN CADENCE variant as unparseable (not silently blessed)", () => {
    // Only BIWEEKLY/MONTHLY/WEEKLY are rendered by the projection engine; an
    // unknown CADENCE value must fail loud (skipped-unparseable), not get stored
    // as a generic-copy LOW sentinel.
    const planned: Parameters<typeof planSeedRule>[3] = [];
    const result = planSeedRule(
      { rrule: "CADENCE=QUARTERLY;BYDAY=SU" },
      dbKennel,
      "dh3-ae",
      planned,
      {},
    );
    expect(result).toBe("skipped-unparseable");
    expect(planned).toHaveLength(0);
  });
});
