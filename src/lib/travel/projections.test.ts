import { describe, it, expect } from "vitest";
import {
  projectTrails,
  scoreConfidence,
  deduplicateAgainstConfirmed,
  buildEvidenceTimeline,
  generateExplanationFromRule,
  clampToProjectionHorizon,
  projectionHorizonForStart,
  filterProjectionsByHorizon,
  type ScheduleRuleInput,
  type ConfirmedEventRef,
} from "./projections";

// ============================================================================
// Helpers
// ============================================================================

function makeRule(overrides: Partial<ScheduleRuleInput> = {}): ScheduleRuleInput {
  return {
    id: "rule-1",
    kennelId: "kennel-1",
    rrule: "FREQ=WEEKLY;BYDAY=SA",
    anchorDate: null,
    startTime: "14:00",
    confidence: "MEDIUM",
    notes: null,
    label: null,
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}

function utcNoon(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00Z");
}

// ============================================================================
// projectTrails
// ============================================================================

describe("projectTrails", () => {
  const windowStart = utcNoon("2026-04-01");
  const windowEnd = utcNoon("2026-04-30");

  it("generates weekly Saturday dates within window", () => {
    const rules = [makeRule()];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results.length).toBeGreaterThanOrEqual(4); // 4-5 Saturdays in April 2026
    expect(results.every((r) => r.date !== null)).toBe(true);
    expect(results.every((r) => r.confidence === "medium")).toBe(true);

    // Verify all dates are Saturdays (UTC day 6)
    for (const r of results) {
      expect(r.date!.getUTCDay()).toBe(6); // Saturday
    }
  });

  it("generates monthly nth-weekday dates", () => {
    const rules = [makeRule({ rrule: "FREQ=MONTHLY;BYDAY=2SA" })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results).toHaveLength(1); // Only one 2nd Saturday in April
    expect(results[0].date!.getUTCDate()).toBe(11); // April 11, 2026 = 2nd Saturday
    expect(results[0].confidence).toBe("medium");
  });

  it("generates biweekly dates with anchor", () => {
    // Anchor on 2026-04-04 (Saturday), interval=2 → expect Apr 4, Apr 18
    const rules = [makeRule({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      anchorDate: "2026-04-04",
      confidence: "HIGH",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results.length).toBe(2);
    expect(results[0].date!.toISOString().slice(0, 10)).toBe("2026-04-04");
    expect(results[1].date!.toISOString().slice(0, 10)).toBe("2026-04-18");
    expect(results.every((r) => r.confidence === "high")).toBe(true);
  });

  it("LOW confidence rules emit date=null (possible activity)", () => {
    const rules = [makeRule({
      rrule: "CADENCE=BIWEEKLY;BYDAY=TH",
      confidence: "LOW",
      notes: "Biweekly without anchor",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results).toHaveLength(1);
    expect(results[0].date).toBeNull();
    expect(results[0].confidence).toBe("low");
  });

  it("FREQ=LUNAR sentinel emits date=null (possible activity)", () => {
    const rules = [makeRule({
      rrule: "FREQ=LUNAR",
      confidence: "LOW",
      notes: "Lunar full moon, exact phase date in America/Los_Angeles",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results).toHaveLength(1);
    expect(results[0].date).toBeNull();
    expect(results[0].confidence).toBe("low");
    expect(results[0].explanation).toContain("Full moon");
  });

  it("FREQ=LUNAR with new-moon notes renders as new-moon (Codex pass-5: phase metadata)", () => {
    const rules = [makeRule({
      rrule: "FREQ=LUNAR",
      confidence: "LOW",
      notes: "Lunar new moon, exact phase date in Asia/Tokyo",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results).toHaveLength(1);
    expect(results[0].date).toBeNull();
    expect(results[0].explanation).toContain("New moon");
    expect(results[0].explanation).not.toContain("Full moon");
  });

  it("FREQ=LUNAR with anchored full-moon notes renders as full-moon", () => {
    const rules = [makeRule({
      rrule: "FREQ=LUNAR",
      confidence: "LOW",
      notes: "Lunar full moon, anchored to SA (nearest)",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results[0].explanation).toContain("Full moon");
  });

  it("CADENCE=MONTHLY sentinel emits date=null", () => {
    const rules = [makeRule({
      rrule: "CADENCE=MONTHLY;BYDAY=SA",
      confidence: "LOW",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results).toHaveLength(1);
    expect(results[0].date).toBeNull();
    expect(results[0].confidence).toBe("low");
  });

  it("unparseable RRULE falls back to LOW with date=null instead of crashing", () => {
    const rules = [makeRule({
      rrule: "FREQ=YEARLY;BYDAY=SA",
      confidence: "MEDIUM",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    // Should not throw, should fall back gracefully
    expect(results).toHaveLength(1);
    expect(results[0].date).toBeNull();
    expect(results[0].confidence).toBe("low");
  });

  it("sorts date-specific results before null-date results", () => {
    const rules = [
      makeRule({ id: "r1", rrule: "CADENCE=BIWEEKLY;BYDAY=SA", confidence: "LOW" }),
      makeRule({ id: "r2", rrule: "FREQ=WEEKLY;BYDAY=SA", confidence: "MEDIUM" }),
    ];
    const results = projectTrails(rules, windowStart, windowEnd);

    // All date-specific results should come before the null-date one
    const nullIdx = results.findIndex((r) => r.date === null);
    const datedResults = results.filter((r) => r.date !== null);
    expect(datedResults.length).toBeGreaterThan(0);
    expect(nullIdx).toBe(results.length - 1); // null-date is last
  });

  it("handles multiple rules for same kennel", () => {
    const rules = [
      makeRule({ id: "r1", rrule: "FREQ=WEEKLY;BYDAY=SA", startTime: "14:00" }),
      makeRule({ id: "r2", rrule: "FREQ=WEEKLY;BYDAY=WE", startTime: "19:00" }),
    ];
    const results = projectTrails(rules, windowStart, windowEnd);

    // Should have both Saturday and Wednesday dates
    const days = new Set(results.map((r) => r.date!.getUTCDay()));
    expect(days.has(6)).toBe(true); // Saturday
    expect(days.has(3)).toBe(true); // Wednesday
  });

  it("empty rules array returns empty results", () => {
    expect(projectTrails([], windowStart, windowEnd)).toEqual([]);
  });

  it("deduplicates overlapping rules for same kennel+date, keeping highest confidence", () => {
    // Simulate a kennel with both STATIC_SCHEDULE (HIGH) and SEED_DATA (MEDIUM) rules
    // producing the same Saturday dates
    const rules = [
      makeRule({ id: "r-high", rrule: "FREQ=WEEKLY;BYDAY=SA", confidence: "HIGH" }),
      makeRule({ id: "r-med", rrule: "FREQ=WEEKLY;BYDAY=SA", confidence: "MEDIUM" }),
    ];
    const results = projectTrails(rules, windowStart, windowEnd);

    // Count unique (kennelId, date) pairs — should have no duplicates
    const seen = new Set<string>();
    for (const r of results) {
      if (r.date) {
        const key = `${r.kennelId}:${r.date.toISOString().slice(0, 10)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }

    // All kept results should be HIGH confidence (the winner)
    const datedResults = results.filter((r) => r.date !== null);
    expect(datedResults.length).toBeGreaterThan(0);
    expect(datedResults.every((r) => r.confidence === "high")).toBe(true);
  });

  it("deduplicates null-date possible activity per kennel", () => {
    // Two LOW rules for the same kennel → only one possible-activity entry
    const rules = [
      makeRule({ id: "r1", rrule: "CADENCE=BIWEEKLY;BYDAY=SA", confidence: "LOW" }),
      makeRule({ id: "r2", rrule: "FREQ=LUNAR", confidence: "LOW" }),
    ];
    const results = projectTrails(rules, windowStart, windowEnd);
    const nullDateResults = results.filter((r) => r.date === null);
    expect(nullDateResults).toHaveLength(1); // Only one "possible" per kennel
  });
});

// ============================================================================
// scoreConfidence
// ============================================================================

describe("scoreConfidence", () => {
  const kennel = {
    id: "k1",
    shortName: "TestH3",
    scheduleDayOfWeek: "Saturday",
    scheduleTime: "2:00 PM",
    scheduleFrequency: "Weekly",
    lastEventDate: new Date(), // recently active
  };

  it("LOW confidence is never upgraded", () => {
    expect(scoreConfidence("low", kennel, 10, new Date())).toBe("low");
  });

  it("MEDIUM upgrades to HIGH with strong evidence", () => {
    const recentValidation = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    expect(scoreConfidence("medium", kennel, 5, recentValidation)).toBe("high");
  });

  it("MEDIUM stays MEDIUM without enough confirmed events", () => {
    const recentValidation = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(scoreConfidence("medium", kennel, 1, recentValidation)).toBe("medium");
  });

  it("HIGH degrades to MEDIUM with stale validation", () => {
    const staleValidation = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago
    expect(scoreConfidence("high", kennel, 5, staleValidation)).toBe("medium");
  });

  it("MEDIUM degrades to LOW when kennel is inactive and no recent events", () => {
    const inactiveKennel = {
      ...kennel,
      lastEventDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
    };
    expect(scoreConfidence("medium", inactiveKennel, 0, null)).toBe("low");
  });

  it("MEDIUM degrades to LOW with zero events even when kennel is recently active", () => {
    // PRD §Confidence Model: Medium requires ≥1 recent run within the
    // evidence window. Pre-fix, a recently-active kennel could emit
    // Medium with zero events because the inactive-kennel guard didn't
    // fire — producing the "Medium · 0 runs in last 12 weeks" trust bug.
    const recentValidation = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(scoreConfidence("medium", kennel, 0, recentValidation)).toBe("low");
  });

  it("HIGH stays HIGH with recent events and validation", () => {
    const recentValidation = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(scoreConfidence("high", kennel, 10, recentValidation)).toBe("high");
  });

  it("handles null lastValidatedAt gracefully", () => {
    // No validation date — should not crash, should not boost
    expect(scoreConfidence("medium", kennel, 5, null)).toBe("medium");
  });

  it("handles null lastEventDate gracefully", () => {
    const noLastEvent = { ...kennel, lastEventDate: null };
    expect(scoreConfidence("medium", noLastEvent, 3, new Date())).toBe("high");
  });
});

// ============================================================================
// deduplicateAgainstConfirmed
// ============================================================================

describe("deduplicateAgainstConfirmed", () => {
  it("removes projections that match a confirmed event on same kennel+date", () => {
    const projections = [
      { kennelId: "k1", date: utcNoon("2026-04-05"), confidence: "medium" as const, startTime: "14:00", scheduleRuleId: "r1", explanation: "", evidenceWindow: "" },
      { kennelId: "k1", date: utcNoon("2026-04-12"), confidence: "medium" as const, startTime: "14:00", scheduleRuleId: "r1", explanation: "", evidenceWindow: "" },
      { kennelId: "k2", date: utcNoon("2026-04-05"), confidence: "medium" as const, startTime: "19:00", scheduleRuleId: "r2", explanation: "", evidenceWindow: "" },
    ];
    const confirmed: ConfirmedEventRef[] = [
      { kennelId: "k1", date: utcNoon("2026-04-05") }, // Matches first projection
    ];

    const result = deduplicateAgainstConfirmed(projections, confirmed);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.kennelId === "k1" && r.date?.toISOString().includes("2026-04-05"))).toBeUndefined();
    expect(result.find((r) => r.kennelId === "k1" && r.date?.toISOString().includes("2026-04-12"))).toBeDefined();
    expect(result.find((r) => r.kennelId === "k2")).toBeDefined();
  });

  it("keeps null-date projections (possible activity) even if kennel has confirmed events", () => {
    const projections = [
      { kennelId: "k1", date: null, confidence: "low" as const, startTime: null, scheduleRuleId: "r1", explanation: "", evidenceWindow: "" },
    ];
    const confirmed: ConfirmedEventRef[] = [
      { kennelId: "k1", date: utcNoon("2026-04-05") },
    ];

    const result = deduplicateAgainstConfirmed(projections, confirmed);
    expect(result).toHaveLength(1); // null-date should survive
  });

  it("handles empty confirmed events array", () => {
    const projections = [
      { kennelId: "k1", date: utcNoon("2026-04-05"), confidence: "medium" as const, startTime: "14:00", scheduleRuleId: "r1", explanation: "", evidenceWindow: "" },
    ];
    const result = deduplicateAgainstConfirmed(projections, []);
    expect(result).toHaveLength(1);
  });

  it("handles empty projections array", () => {
    const confirmed: ConfirmedEventRef[] = [
      { kennelId: "k1", date: utcNoon("2026-04-05") },
    ];
    expect(deduplicateAgainstConfirmed([], confirmed)).toEqual([]);
  });
});

// ============================================================================
// buildEvidenceTimeline
// ============================================================================

describe("buildEvidenceTimeline", () => {
  const refDate = utcNoon("2026-04-12");

  it("marks weeks with events as true", () => {
    // refDate = 2026-04-12. Window starts 12 weeks before = 2026-01-18.
    // Weeks are forward-indexed: week 0 = Jan 18–25, ..., week 11 = Apr 5–12.
    const events = [
      { date: utcNoon("2026-04-10") },  // 2 days ago → week 11 (most recent)
      { date: utcNoon("2026-04-01") },  // 11 days ago → week 10
    ];
    const timeline = buildEvidenceTimeline(events, refDate);

    expect(timeline.totalEvents).toBe(2);
    expect(timeline.weeks).toHaveLength(12);
    expect(timeline.weeks[11]).toBe(true);
    expect(timeline.weeks[10]).toBe(true);
    // Earlier weeks should be false
    expect(timeline.weeks[0]).toBe(false);
  });

  it("returns all false for zero events", () => {
    const timeline = buildEvidenceTimeline([], refDate);
    expect(timeline.totalEvents).toBe(0);
    expect(timeline.weeks.every((w) => w === false)).toBe(true);
  });

  it("handles all weeks filled", () => {
    // One event per week for 12 weeks
    const events = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(refDate.getTime() - (12 - i) * 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000),
    }));
    const timeline = buildEvidenceTimeline(events, refDate);
    expect(timeline.totalEvents).toBe(12);
    expect(timeline.weeks.every((w) => w === true)).toBe(true);
  });

  it("ignores events outside the 12-week window", () => {
    const events = [
      { date: utcNoon("2025-01-01") }, // Way too old
    ];
    const timeline = buildEvidenceTimeline(events, refDate);
    expect(timeline.totalEvents).toBe(0);
  });

  it("handles multiple events in the same week (counts total correctly)", () => {
    const events = [
      { date: utcNoon("2026-04-05") },
      { date: utcNoon("2026-04-06") },
      { date: utcNoon("2026-04-07") },
    ];
    const timeline = buildEvidenceTimeline(events, refDate);
    expect(timeline.totalEvents).toBe(3);
    // All in the same week bucket
    const trueCount = timeline.weeks.filter(Boolean).length;
    expect(trueCount).toBeGreaterThanOrEqual(1);
    expect(trueCount).toBeLessThanOrEqual(2); // Could span 1-2 weeks depending on bucket boundary
  });
});

// ============================================================================
// generateExplanationFromRule
// ============================================================================

describe("generateExplanationFromRule", () => {
  it("weekly rule → 'Usually runs on Saturdays at ...'", () => {
    const explanation = generateExplanationFromRule(makeRule());
    expect(explanation).toContain("Saturday");
    expect(explanation).toContain("2:00 PM");
  });

  it("monthly nth rule → 'Monthly on the 2nd Saturday'", () => {
    const explanation = generateExplanationFromRule(makeRule({
      rrule: "FREQ=MONTHLY;BYDAY=2SA",
    }));
    expect(explanation).toContain("second");
    expect(explanation).toContain("Saturday");
  });

  it("FREQ=LUNAR → 'Full moon schedule'", () => {
    const explanation = generateExplanationFromRule(makeRule({
      rrule: "FREQ=LUNAR",
      confidence: "LOW",
    }));
    expect(explanation).toContain("Full moon");
  });

  it("CADENCE=BIWEEKLY → 'alternating' with day name", () => {
    const explanation = generateExplanationFromRule(makeRule({
      rrule: "CADENCE=BIWEEKLY;BYDAY=TH",
      confidence: "LOW",
    }));
    expect(explanation).toContain("alternating");
    expect(explanation).toContain("Thursday");
  });

  it("CADENCE=MONTHLY → 'Monthly on a' with day name", () => {
    const explanation = generateExplanationFromRule(makeRule({
      rrule: "CADENCE=MONTHLY;BYDAY=SA",
      confidence: "LOW",
    }));
    expect(explanation).toContain("Monthly");
    expect(explanation).toContain("Saturday");
    expect(explanation).toContain("specific week unknown");
  });

  it("includes startTime when present", () => {
    const withTime = generateExplanationFromRule(makeRule({ startTime: "19:00" }));
    expect(withTime).toContain("7:00 PM");

    const noTime = generateExplanationFromRule(makeRule({ startTime: null }));
    expect(noTime).not.toContain("PM");
    expect(noTime).not.toContain("AM");
  });
});

// ============================================================================
// clampToProjectionHorizon
// ============================================================================

describe("clampToProjectionHorizon", () => {
  const refDate = utcNoon("2026-04-12");

  it("clamps dates beyond 365 days from reference", () => {
    const farFuture = utcNoon("2028-01-01");
    const clamped = clampToProjectionHorizon(farFuture, refDate);
    expect(clamped.getTime()).toBeLessThan(farFuture.getTime());
    const diffDays = (clamped.getTime() - refDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(365, 0);
  });

  it("does not clamp dates within 365 days", () => {
    const withinYear = utcNoon("2027-01-01"); // ~264 days out
    const clamped = clampToProjectionHorizon(withinYear, refDate);
    expect(clamped.getTime()).toBe(withinYear.getTime());
  });

  it("handles exact boundary (365 days out)", () => {
    const exactly365 = new Date(refDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    const clamped = clampToProjectionHorizon(exactly365, refDate);
    expect(clamped.getTime()).toBe(exactly365.getTime());
  });
});

describe("projectionHorizonForStart", () => {
  const now = utcNoon("2026-04-12");

  it("returns 'all' for dates within 180 days", () => {
    expect(projectionHorizonForStart(utcNoon("2026-05-01"), now)).toBe("all");
    expect(
      projectionHorizonForStart(new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000), now),
    ).toBe("all");
  });

  it("returns 'high' for dates between 181 and 365 days", () => {
    expect(projectionHorizonForStart(utcNoon("2026-12-01"), now)).toBe("high");
    expect(
      projectionHorizonForStart(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), now),
    ).toBe("high");
  });

  it("returns 'none' past 365 days", () => {
    expect(projectionHorizonForStart(utcNoon("2028-01-01"), now)).toBe("none");
  });
});

describe("filterProjectionsByHorizon", () => {
  const mixed = [
    { confidence: "high" as const, id: "h1" },
    { confidence: "medium" as const, id: "m1" },
    { confidence: "low" as const, id: "l1" },
  ];

  it("returns all projections at tier 'all'", () => {
    expect(filterProjectionsByHorizon(mixed, "all")).toHaveLength(3);
  });

  it("keeps HIGH + LOW but drops MEDIUM at tier 'high'", () => {
    const out = filterProjectionsByHorizon(mixed, "high");
    expect(out.map((p) => p.id).sort((a, b) => a.localeCompare(b))).toEqual(["h1", "l1"]);
  });

  it("returns [] at tier 'none' — projections drop entirely past 365d", () => {
    // Regression: tier-3 empty state arbiter relies on this. A LOW
    // projection surviving past the 365d horizon flips the UI off the
    // "More than a year out" path and back to the tier-2 "No posted
    // trails" copy with a stray Possible row.
    expect(filterProjectionsByHorizon(mixed, "none")).toEqual([]);
    expect(filterProjectionsByHorizon([{ confidence: "low" as const }], "none")).toEqual([]);
  });
});

// ============================================================================
// #1390: seasonal gating — Hockessin Wed/summer ↔ Sat/winter is the proving case
// ============================================================================

describe("projectTrails — seasonal gating (#1390)", () => {
  // Hockessin's structured-cadence shape: Wed at 18:30 from Mar 1 → Oct 31,
  // Sat at 15:00 from Nov 1 → Feb 28.
  const summerWednesdayRule = makeRule({
    id: "rule-summer",
    rrule: "FREQ=WEEKLY;BYDAY=WE",
    startTime: "18:30",
    confidence: "HIGH",
    label: "Summer",
    validFrom: "03-01",
    validUntil: "10-31",
  });
  const winterSaturdayRule = makeRule({
    id: "rule-winter",
    rrule: "FREQ=WEEKLY;BYDAY=SA",
    startTime: "15:00",
    confidence: "HIGH",
    label: "Winter",
    validFrom: "11-01",
    validUntil: "02-29",
  });

  it("emits ONLY summer Wednesdays in a July search window", () => {
    // July is mid-summer; winter rule should produce zero projections.
    const projections = projectTrails(
      [summerWednesdayRule, winterSaturdayRule],
      utcNoon("2026-07-01"),
      utcNoon("2026-07-31"),
    );
    expect(projections.length).toBeGreaterThan(0);
    expect(projections.every((p) => p.scheduleRuleId === "rule-summer")).toBe(true);
    // Every projected date should be a Wednesday (day=3).
    expect(projections.every((p) => p.date?.getUTCDay() === 3)).toBe(true);
  });

  it("emits ONLY winter Saturdays in a January search window (wrap-around)", () => {
    const projections = projectTrails(
      [summerWednesdayRule, winterSaturdayRule],
      utcNoon("2026-01-01"),
      utcNoon("2026-01-31"),
    );
    expect(projections.length).toBeGreaterThan(0);
    expect(projections.every((p) => p.scheduleRuleId === "rule-winter")).toBe(true);
    expect(projections.every((p) => p.date?.getUTCDay() === 6)).toBe(true);
  });

  it("emits BOTH cadences in a search window that straddles the season boundary", () => {
    // Oct 25 → Nov 10 covers the summer-Wed Oct 28 AND the winter-Sat Nov 7.
    const projections = projectTrails(
      [summerWednesdayRule, winterSaturdayRule],
      utcNoon("2026-10-25"),
      utcNoon("2026-11-10"),
    );
    const ruleIds = new Set(projections.map((p) => p.scheduleRuleId));
    expect(ruleIds.has("rule-summer")).toBe(true);
    expect(ruleIds.has("rule-winter")).toBe(true);
  });

  it("includes the season label in the explanation string", () => {
    const explanation = generateExplanationFromRule(summerWednesdayRule);
    expect(explanation).toContain("Summer");
    expect(explanation).toContain("Mar"); // Mar–Oct range
  });

  it("works for rules with only validFrom (open-ended end)", () => {
    const openEndedRule = makeRule({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      confidence: "HIGH",
      validFrom: "06-01",
      validUntil: null,
    });
    // May → before season → no projections
    const beforeSeason = projectTrails(
      [openEndedRule],
      utcNoon("2026-05-01"),
      utcNoon("2026-05-31"),
    );
    expect(beforeSeason).toEqual([]);
    // July → in season
    const inSeason = projectTrails(
      [openEndedRule],
      utcNoon("2026-07-01"),
      utcNoon("2026-07-31"),
    );
    expect(inSeason.length).toBeGreaterThan(0);
  });

  it("skips LOW-confidence rule entirely when window is wholly off-season (Codex P2)", () => {
    // Winter-only CADENCE sentinel rule (LOW confidence — no date generation).
    // A July search must NOT emit a date-null "possible activity" entry for it.
    const winterOnlyLowRule = makeRule({
      rrule: "CADENCE=BIWEEKLY;BYDAY=SA",
      confidence: "LOW",
      notes: "Biweekly without anchor",
      label: "Winter",
      validFrom: "11-01",
      validUntil: "02-28",
    });
    const julyProjections = projectTrails(
      [winterOnlyLowRule],
      utcNoon("2026-07-01"),
      utcNoon("2026-07-31"),
    );
    expect(julyProjections).toEqual([]);
  });

  it("still emits LOW-confidence possible-activity when window IS in-season", () => {
    const winterOnlyLowRule = makeRule({
      rrule: "CADENCE=BIWEEKLY;BYDAY=SA",
      confidence: "LOW",
      notes: "Biweekly without anchor",
      label: "Winter",
      validFrom: "11-01",
      validUntil: "02-28",
    });
    const januaryProjections = projectTrails(
      [winterOnlyLowRule],
      utcNoon("2026-01-01"),
      utcNoon("2026-01-31"),
    );
    expect(januaryProjections).toHaveLength(1);
    expect(januaryProjections[0].date).toBeNull();
    expect(januaryProjections[0].confidence).toBe("low");
  });

  it("skips interval-without-anchor demoted rules when wholly off-season (Codex P2)", () => {
    // Biweekly without anchorDate is demoted to LOW inside projectScheduledRule.
    // The rule-level season gate should catch it BEFORE projectScheduledRule
    // runs.
    const winterBiweeklyNoAnchor = makeRule({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      confidence: "HIGH",
      anchorDate: null,
      label: "Winter",
      validFrom: "11-01",
      validUntil: "02-28",
    });
    const julyProjections = projectTrails(
      [winterBiweeklyNoAnchor],
      utcNoon("2026-07-01"),
      utcNoon("2026-07-31"),
    );
    expect(julyProjections).toEqual([]);
  });

  it("rules without season anchors continue to project normally", () => {
    // Pre-PR behavior preservation: a rule with label=null/validFrom=null
    // emits every occurrence in the window.
    const noSeasonRule = makeRule({
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      confidence: "HIGH",
    });
    const projections = projectTrails(
      [noSeasonRule],
      utcNoon("2026-07-01"),
      utcNoon("2026-07-31"),
    );
    expect(projections.length).toBeGreaterThan(0);
  });
});
