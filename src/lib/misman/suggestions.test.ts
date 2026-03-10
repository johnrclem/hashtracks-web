import { describe, it, expect } from "vitest";
import {
  computeSuggestionScores,
  SUGGESTION_THRESHOLD,
  MIN_EVENTS_FOR_SUGGESTIONS,
  type SuggestionInput,
  type KennelEvent,
  type AttendanceRecord,
} from "./suggestions";

const KENNEL_ID = "kennel-1";
const REF_DATE = new Date("2026-02-15T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(REF_DATE.getTime() - n * 24 * 60 * 60 * 1000);
}

function makeEvents(count: number, startDaysAgo = 7): KennelEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    date: daysAgo(startDaysAgo + i * 7), // weekly events
  }));
}

function makeInput(overrides: Partial<SuggestionInput> = {}): SuggestionInput {
  const kennelEvents = overrides.kennelEvents ?? makeEvents(6);
  const rosterEvents = overrides.rosterEvents ?? kennelEvents;
  return {
    kennelId: KENNEL_ID,
    rosterKennelIds: [KENNEL_ID],
    kennelEvents,
    rosterEvents,
    attendanceRecords: [],
    rosterHasherIds: [],
    ...overrides,
  };
}

/** Helper: create attendance records for a hasher at all given events */
function attendAll(hasherId: string, events: KennelEvent[]): AttendanceRecord[] {
  return events.map((e) => ({
    kennelHasherId: hasherId,
    eventId: e.id,
    eventDate: e.date,
  }));
}

describe("computeSuggestionScores", () => {
  it("returns empty array when no events exist", () => {
    const result = computeSuggestionScores(
      makeInput({ kennelEvents: [], rosterEvents: [] }),
      REF_DATE,
    );
    expect(result).toEqual([]);
  });

  it("returns empty when fewer than MIN_EVENTS recorded events", () => {
    const result = computeSuggestionScores(
      makeInput({ kennelEvents: makeEvents(MIN_EVENTS_FOR_SUGGESTIONS - 1) }),
      REF_DATE,
    );
    expect(result).toEqual([]);
  });

  it("returns empty when no hashers in roster", () => {
    const result = computeSuggestionScores(
      makeInput({ rosterHasherIds: [] }),
      REF_DATE,
    );
    expect(result).toEqual([]);
  });

  it("scores a perfect regular near 1.0", () => {
    const events = makeEvents(6);
    const records: AttendanceRecord[] = attendAll("hasher-1", events);

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1"],
      }),
      REF_DATE,
    );

    expect(result).toHaveLength(1);
    expect(result[0].kennelHasherId).toBe("hasher-1");
    // frequency=1.0, rosterFrequency=1.0, recency≈1.0, streak=1.0 → score ≈ 1.0
    expect(result[0].score).toBeGreaterThan(0.9);
  });

  it("scores a one-time attendee from long ago low", () => {
    const events = makeEvents(6);
    // h2 attends all events (makes them recorded), h1 attended only oldest
    const records: AttendanceRecord[] = [
      ...attendAll("h2", events),
      {
        kennelHasherId: "hasher-1",
        eventId: events[5].id, // oldest event (~42 days ago)
        eventDate: events[5].date,
      },
    ];

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1", "h2"],
      }),
      REF_DATE,
    );

    const h1 = result.find((r) => r.kennelHasherId === "hasher-1");
    // frequency=1/6≈0.167, recency low, streak=0 (gap at most recent)
    if (h1) {
      expect(h1.score).toBeLessThan(0.4);
    }
  });

  it("kennel frequency is zero for cross-kennel-only hasher", () => {
    const events = makeEvents(4);
    const otherKennelEvents: KennelEvent[] = Array.from({ length: 3 }, (_, i) => ({
      id: `other-event-${i}`,
      date: daysAgo(3 + i * 7),
    }));
    const rosterEvents = [...events, ...otherKennelEvents];

    // Hasher only attended the other kennel's events
    const records: AttendanceRecord[] = attendAll("hasher-1", otherKennelEvents);

    const result = computeSuggestionScores(
      makeInput({
        rosterKennelIds: [KENNEL_ID, "kennel-2"],
        kennelEvents: events,
        rosterEvents,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1"],
      }),
      REF_DATE,
    );

    // Kennel frequency should be 0 (attended 0 events for this kennel)
    // But roster frequency > 0 and recency > 0, so they still get suggested
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(0);
    expect(result[0].rosterFrequency).toBeGreaterThan(0);
    expect(result[0].recency).toBeGreaterThan(0);
    expect(result[0].score).toBeGreaterThan(SUGGESTION_THRESHOLD);
  });

  it("recency considers roster group attendance", () => {
    const events = makeEvents(4);
    const otherEvents: KennelEvent[] = Array.from({ length: 3 }, (_, i) => ({
      id: `other-event-${i}`,
      date: daysAgo(1 + i * 7),
    }));
    const rosterEvents = [...events, ...otherEvents];

    // Hasher attended this kennel's most recent event + all recent other-kennel events
    const records: AttendanceRecord[] = [
      {
        kennelHasherId: "hasher-1",
        eventId: events[0].id,
        eventDate: events[0].date,
      },
      ...attendAll("hasher-1", otherEvents),
    ];

    const result = computeSuggestionScores(
      makeInput({
        rosterKennelIds: [KENNEL_ID, "kennel-2"],
        kennelEvents: events,
        rosterEvents,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1"],
      }),
      REF_DATE,
    );

    expect(result).toHaveLength(1);
    // Recency should be very high (attended yesterday in roster group)
    expect(result[0].recency).toBeGreaterThan(0.9);
  });

  it("streak resets after a gap at a recorded event", () => {
    const events = makeEvents(6);
    // h1: attended most recent 2, skipped 3rd, attended 4th
    // h2: attended all 6 (ensures every event is recorded)
    const records: AttendanceRecord[] = [
      { kennelHasherId: "h1", eventId: events[0].id, eventDate: events[0].date },
      { kennelHasherId: "h1", eventId: events[1].id, eventDate: events[1].date },
      // h1 gap at events[2]
      { kennelHasherId: "h1", eventId: events[3].id, eventDate: events[3].date },
      ...attendAll("h2", events),
    ];

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["h1", "h2"],
      }),
      REF_DATE,
    );

    const h1 = result.find((r) => r.kennelHasherId === "h1");
    expect(h1).toBeDefined();
    // Streak should be 2 (broke at the gap), normalized to 2/4 = 0.5
    expect(h1!.streak).toBe(0.5);
  });

  it("streak caps at MAX_STREAK (4)", () => {
    const events = makeEvents(6);
    // Attended all 6 events
    const records: AttendanceRecord[] = attendAll("h1", events);

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["h1"],
      }),
      REF_DATE,
    );

    expect(result).toHaveLength(1);
    // Streak capped at 4, normalized to 4/4 = 1.0
    expect(result[0].streak).toBe(1);
  });

  it("filters out hashers below the threshold", () => {
    const events = makeEvents(10);
    // hasher-1 attended every event; hasher-2 attended 0
    const records: AttendanceRecord[] = attendAll("hasher-1", events);

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1", "hasher-2"],
      }),
      REF_DATE,
    );

    // hasher-2 should be filtered out (score = 0)
    expect(result).toHaveLength(1);
    expect(result[0].kennelHasherId).toBe("hasher-1");
  });

  it("sorts by score descending", () => {
    const events = makeEvents(6);
    // h-regular: attended all 6; h-occasional: attended 3 most recent
    const records: AttendanceRecord[] = [
      ...attendAll("h-regular", events),
      ...attendAll("h-occasional", events.slice(0, 3)),
    ];

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["h-regular", "h-occasional"],
      }),
      REF_DATE,
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].kennelHasherId).toBe("h-regular");
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("reference date parameter enables deterministic testing", () => {
    const events = makeEvents(4);
    const records: AttendanceRecord[] = attendAll("h1", events);
    const input = makeInput({
      kennelEvents: events,
      attendanceRecords: records,
      rosterHasherIds: ["h1"],
    });

    const result1 = computeSuggestionScores(input, REF_DATE);
    const result2 = computeSuggestionScores(input, REF_DATE);

    expect(result1).toEqual(result2);
  });

  describe("recorded events handling", () => {
    it("unrecorded events do not dilute frequency", () => {
      // 10 scraped events but only 3 have attendance records
      const events = makeEvents(10);
      // h1 attended events[0-2] (the only 3 recorded events)
      const records: AttendanceRecord[] = attendAll("h1", events.slice(0, 3));

      const result = computeSuggestionScores(
        makeInput({
          kennelEvents: events,
          attendanceRecords: records,
          rosterHasherIds: ["h1"],
        }),
        REF_DATE,
      );

      expect(result).toHaveLength(1);
      // h1 attended all 3 recorded events → frequency = 3/3 = 1.0 (not 3/10)
      expect(result[0].frequency).toBe(1);
    });

    it("streak skips unrecorded events", () => {
      // 6 events; only events[0], events[2], events[4] have attendance
      const events = makeEvents(6);
      const records: AttendanceRecord[] = [
        // h1 attended events[0] and events[2]
        { kennelHasherId: "h1", eventId: events[0].id, eventDate: events[0].date },
        { kennelHasherId: "h1", eventId: events[2].id, eventDate: events[2].date },
        // h2 attended events[4] (makes it recorded, but h1 didn't attend)
        { kennelHasherId: "h2", eventId: events[4].id, eventDate: events[4].date },
      ];

      const result = computeSuggestionScores(
        makeInput({
          kennelEvents: events,
          attendanceRecords: records,
          rosterHasherIds: ["h1", "h2"],
        }),
        REF_DATE,
      );

      const h1 = result.find((r) => r.kennelHasherId === "h1");
      expect(h1).toBeDefined();
      // Recorded events in desc order: events[0], events[2], events[4]
      // h1: events[0] ✓, events[2] ✓, events[4] ✗ → streak = 2, normalized 0.5
      expect(h1!.streak).toBe(0.5);
    });

    it("handles sparse attendance across many scraped events", () => {
      // Simulates real NYC scenario: many scraped events, few with attendance
      const events = makeEvents(20);
      // Only 5 most recent events have attendance
      const records: AttendanceRecord[] = [
        ...attendAll("h-regular", events.slice(0, 5)),
        ...attendAll("h-occasional", events.slice(0, 2)),
      ];

      const result = computeSuggestionScores(
        makeInput({
          kennelEvents: events,
          attendanceRecords: records,
          rosterHasherIds: ["h-regular", "h-occasional"],
        }),
        REF_DATE,
      );

      expect(result).toHaveLength(2);
      expect(result[0].kennelHasherId).toBe("h-regular");
      // h-regular: freq = 5/5 = 1.0, streak = 4/4 = 1.0
      expect(result[0].frequency).toBe(1);
      expect(result[0].streak).toBe(1);
      // h-occasional: freq = 2/5 = 0.4
      expect(result[1].frequency).toBe(0.4);
      // Significant score spread (not compressed like old algorithm)
      expect(result[0].score - result[1].score).toBeGreaterThan(0.2);
    });
  });

  describe("cross-kennel roster frequency", () => {
    it("cross-kennel hasher in shared roster gets suggested", () => {
      // Brooklyn has 3 events, NYCH3 has 3 events (6 total roster events)
      const brooklynEvents = makeEvents(3, 7);
      const nycEvents: KennelEvent[] = Array.from({ length: 3 }, (_, i) => ({
        id: `nyc-event-${i}`,
        date: daysAgo(7 + i * 7),
      }));
      const rosterEvents = [...brooklynEvents, ...nycEvents];

      // Hasher attended all 3 NYC events, 0 Brooklyn events
      const records: AttendanceRecord[] = attendAll("hasher-nyc-only", nycEvents);

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID, "kennel-nyc"],
          kennelEvents: brooklynEvents,
          rosterEvents,
          attendanceRecords: records,
          rosterHasherIds: ["hasher-nyc-only"],
        }),
        REF_DATE,
      );

      // Should be suggested (score > 0.3) via roster frequency
      expect(result).toHaveLength(1);
      expect(result[0].kennelHasherId).toBe("hasher-nyc-only");
      expect(result[0].score).toBeGreaterThan(SUGGESTION_THRESHOLD);
      // Kennel frequency is 0 (no Brooklyn recorded events), roster frequency is 3/3 = 1.0
      expect(result[0].frequency).toBe(0);
      expect(result[0].rosterFrequency).toBeGreaterThan(0);
      // Streak should be 0 (never attended Brooklyn)
      expect(result[0].streak).toBe(0);
    });

    it("this-kennel regulars score higher than cross-kennel-only hashers", () => {
      const brooklynEvents = makeEvents(3, 7);
      const nycEvents: KennelEvent[] = Array.from({ length: 3 }, (_, i) => ({
        id: `nyc-event-${i}`,
        date: daysAgo(7 + i * 7),
      }));
      const rosterEvents = [...brooklynEvents, ...nycEvents];

      const records: AttendanceRecord[] = [
        // brooklyn-regular attended all 3 Brooklyn events
        ...attendAll("brooklyn-regular", brooklynEvents),
        // nyc-only attended all 3 NYC events, 0 Brooklyn
        ...attendAll("nyc-only", nycEvents),
      ];

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID, "kennel-nyc"],
          kennelEvents: brooklynEvents,
          rosterEvents,
          attendanceRecords: records,
          rosterHasherIds: ["brooklyn-regular", "nyc-only"],
        }),
        REF_DATE,
      );

      expect(result).toHaveLength(2);
      // Brooklyn regular should score higher
      expect(result[0].kennelHasherId).toBe("brooklyn-regular");
      expect(result[1].kennelHasherId).toBe("nyc-only");
      expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it("single-kennel roster frequency equals kennel frequency", () => {
      const events = makeEvents(6);
      // h1 attended 3 of 6; h2 attended all 6 (ensures all are recorded)
      const records: AttendanceRecord[] = [
        ...attendAll("h1", events.slice(0, 3)),
        ...attendAll("h2", events),
      ];

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID], // single kennel
          kennelEvents: events,
          // rosterEvents defaults to kennelEvents via makeInput
          attendanceRecords: records,
          rosterHasherIds: ["h1", "h2"],
        }),
        REF_DATE,
      );

      const h1 = result.find((r) => r.kennelHasherId === "h1");
      expect(h1).toBeDefined();
      // frequency = 3/6 = 0.5, rosterFrequency should equal frequency
      expect(h1!.frequency).toBe(0.5);
      expect(h1!.rosterFrequency).toBe(0.5);
    });

    it("MIN_EVENTS uses roster recorded events for multi-kennel rosters", () => {
      // Brooklyn has only 1 event (below MIN=3), but roster has 4 total
      const brooklynEvents: KennelEvent[] = [{ id: "bk-1", date: daysAgo(7) }];
      const nycEvents: KennelEvent[] = Array.from({ length: 3 }, (_, i) => ({
        id: `nyc-${i}`,
        date: daysAgo(14 + i * 7),
      }));
      const rosterEvents = [...brooklynEvents, ...nycEvents];

      // Hasher attended all NYC events + the 1 Brooklyn event
      const records: AttendanceRecord[] = [
        { kennelHasherId: "h1", eventId: "bk-1", eventDate: daysAgo(7) },
        ...attendAll("h1", nycEvents),
      ];

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID, "kennel-nyc"],
          kennelEvents: brooklynEvents,
          rosterEvents,
          attendanceRecords: records,
          rosterHasherIds: ["h1"],
        }),
        REF_DATE,
      );

      // Should NOT be empty despite Brooklyn having <3 events
      expect(result).toHaveLength(1);
      expect(result[0].score).toBeGreaterThan(SUGGESTION_THRESHOLD);
    });

    it("single-kennel still returns empty when below MIN_EVENTS", () => {
      const events = makeEvents(MIN_EVENTS_FOR_SUGGESTIONS - 1);
      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID],
          kennelEvents: events,
          rosterEvents: events,
          rosterHasherIds: ["h1"],
        }),
        REF_DATE,
      );
      expect(result).toEqual([]);
    });
  });
});
