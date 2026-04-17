import { describe, it, expect } from "vitest";
import {
  projectTrails,
  scoreConfidence,
  deduplicateAgainstConfirmed,
  buildEvidenceTimeline,
  generateExplanationFromRule,
  clampToProjectionHorizon,
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
      notes: "Full moon schedule",
    })];
    const results = projectTrails(rules, windowStart, windowEnd);

    expect(results).toHaveLength(1);
    expect(results[0].date).toBeNull();
    expect(results[0].confidence).toBe("low");
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

  it("clamps dates beyond 90 days from reference", () => {
    const farFuture = utcNoon("2027-01-01");
    const clamped = clampToProjectionHorizon(farFuture, refDate);
    expect(clamped.getTime()).toBeLessThan(farFuture.getTime());
    // Should be roughly 90 days from refDate
    const diffDays = (clamped.getTime() - refDate.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(90, 0);
  });

  it("does not clamp dates within 90 days", () => {
    const nearFuture = utcNoon("2026-05-01");
    const clamped = clampToProjectionHorizon(nearFuture, refDate);
    expect(clamped.getTime()).toBe(nearFuture.getTime());
  });

  it("handles exact boundary (90 days out)", () => {
    const exactly90 = new Date(refDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    const clamped = clampToProjectionHorizon(exactly90, refDate);
    expect(clamped.getTime()).toBe(exactly90.getTime());
  });
});
