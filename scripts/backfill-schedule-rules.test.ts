import { describe, it, expect } from "vitest";
import {
  parseScheduleTime,
  parseFrequencyDay,
  normalizeRRule,
  runStaticSchedulePass,
  runKennelSeedPass,
  runKennelDisplayPass,
  applyUpserts,
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

describe("applyUpserts — lastValidatedAt update semantics", () => {
  function makePlanned(overrides: {
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

  function makeSpyingPrisma() {
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

  it("INCLUDES lastValidatedAt in update clause for STATIC_SCHEDULE rules", async () => {
    const { prisma, upsertCalls } = makeSpyingPrisma();
    const validatedAt = new Date("2026-05-01T00:00:00Z");
    await applyUpserts(prisma, [
      makePlanned({ source: "STATIC_SCHEDULE", lastValidatedAt: validatedAt }),
    ]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].update).toHaveProperty("lastValidatedAt", validatedAt);
    // Create always carries it
    expect(upsertCalls[0].create.lastValidatedAt).toEqual(validatedAt);
  });

  it("EXCLUDES lastValidatedAt from update clause for SEED_DATA rules (preserves admin timestamps)", async () => {
    const { prisma, upsertCalls } = makeSpyingPrisma();
    await applyUpserts(prisma, [
      makePlanned({ source: "SEED_DATA", lastValidatedAt: new Date() }),
    ]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].update).not.toHaveProperty("lastValidatedAt");
    // Create always carries it — first-seen moment is recorded.
    expect(upsertCalls[0].create).toHaveProperty("lastValidatedAt");
  });
});
