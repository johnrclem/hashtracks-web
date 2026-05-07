import { describe, it, expect } from "vitest";
import {
  parseScheduleTime,
  parseFrequencyDay,
  normalizeRRule,
  runStaticSchedulePass,
} from "./backfill-schedule-rules";

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
