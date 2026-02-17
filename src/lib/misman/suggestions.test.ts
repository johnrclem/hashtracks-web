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
  const eventKennelMap = new Map<string, string>();
  for (const e of kennelEvents) {
    eventKennelMap.set(e.id, KENNEL_ID);
  }
  if (overrides.rosterEvents) {
    for (const e of overrides.rosterEvents) {
      if (!eventKennelMap.has(e.id)) {
        eventKennelMap.set(e.id, "kennel-2");
      }
    }
  }
  return {
    kennelId: KENNEL_ID,
    rosterKennelIds: [KENNEL_ID],
    kennelEvents,
    rosterEvents,
    attendanceRecords: [],
    rosterHasherIds: [],
    eventKennelMap,
    ...overrides,
  };
}

describe("computeSuggestionScores", () => {
  it("returns empty array when no events exist", () => {
    const result = computeSuggestionScores(
      makeInput({ kennelEvents: [], rosterEvents: [] }),
      REF_DATE,
    );
    expect(result).toEqual([]);
  });

  it("returns empty when fewer than MIN_EVENTS kennel events", () => {
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
    const records: AttendanceRecord[] = events.map((e) => ({
      kennelHasherId: "hasher-1",
      eventId: e.id,
      eventDate: e.date,
    }));

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
    const records: AttendanceRecord[] = [
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
        rosterHasherIds: ["hasher-1"],
      }),
      REF_DATE,
    );

    // frequency=1/6≈0.167, recency depends on date, streak=0 (gap at most recent)
    // Should be below threshold or very low
    if (result.length > 0) {
      expect(result[0].score).toBeLessThan(0.4);
    }
  });

  it("kennel frequency is zero for cross-kennel-only hasher", () => {
    const events = makeEvents(4);
    const otherKennelEvent: KennelEvent = {
      id: "other-event-1",
      date: daysAgo(3),
    };
    const rosterEvents = [...events, otherKennelEvent];

    const eventKennelMap = new Map<string, string>();
    for (const e of events) eventKennelMap.set(e.id, KENNEL_ID);
    eventKennelMap.set("other-event-1", "kennel-2");

    // Hasher only attended the other kennel's event
    const records: AttendanceRecord[] = [
      {
        kennelHasherId: "hasher-1",
        eventId: "other-event-1",
        eventDate: otherKennelEvent.date,
      },
    ];

    const result = computeSuggestionScores(
      makeInput({
        rosterKennelIds: [KENNEL_ID, "kennel-2"],
        kennelEvents: events,
        rosterEvents,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1"],
        eventKennelMap,
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
    const otherEvent: KennelEvent = { id: "other-event", date: daysAgo(1) };
    const rosterEvents = [...events, otherEvent];
    const eventKennelMap = new Map<string, string>();
    for (const e of events) eventKennelMap.set(e.id, KENNEL_ID);
    eventKennelMap.set("other-event", "kennel-2");

    // Hasher attended this kennel's events AND a very recent other-kennel event
    const records: AttendanceRecord[] = [
      {
        kennelHasherId: "hasher-1",
        eventId: events[0].id,
        eventDate: events[0].date,
      },
      {
        kennelHasherId: "hasher-1",
        eventId: "other-event",
        eventDate: daysAgo(1), // very recent
      },
    ];

    const result = computeSuggestionScores(
      makeInput({
        rosterKennelIds: [KENNEL_ID, "kennel-2"],
        kennelEvents: events,
        rosterEvents,
        attendanceRecords: records,
        rosterHasherIds: ["hasher-1"],
        eventKennelMap,
      }),
      REF_DATE,
    );

    expect(result).toHaveLength(1);
    // Recency should be very high (attended yesterday in roster group)
    expect(result[0].recency).toBeGreaterThan(0.9);
  });

  it("streak resets after a gap", () => {
    const events = makeEvents(6);
    // Attended most recent 2, skipped 3rd, attended 4th
    const records: AttendanceRecord[] = [
      { kennelHasherId: "h1", eventId: events[0].id, eventDate: events[0].date },
      { kennelHasherId: "h1", eventId: events[1].id, eventDate: events[1].date },
      // gap at events[2]
      { kennelHasherId: "h1", eventId: events[3].id, eventDate: events[3].date },
    ];

    const result = computeSuggestionScores(
      makeInput({
        kennelEvents: events,
        attendanceRecords: records,
        rosterHasherIds: ["h1"],
      }),
      REF_DATE,
    );

    expect(result).toHaveLength(1);
    // Streak should be 2 (broke at the gap), normalized to 2/4 = 0.5
    expect(result[0].streak).toBe(0.5);
  });

  it("streak caps at MAX_STREAK (4)", () => {
    const events = makeEvents(6);
    // Attended all 6 events
    const records: AttendanceRecord[] = events.map((e) => ({
      kennelHasherId: "h1",
      eventId: e.id,
      eventDate: e.date,
    }));

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
    const records: AttendanceRecord[] = events.map((e) => ({
      kennelHasherId: "hasher-1",
      eventId: e.id,
      eventDate: e.date,
    }));

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
    // hasher-1: attended all 6; hasher-2: attended 3 most recent
    const records: AttendanceRecord[] = [
      ...events.map((e) => ({
        kennelHasherId: "h-regular" as string,
        eventId: e.id,
        eventDate: e.date,
      })),
      ...events.slice(0, 3).map((e) => ({
        kennelHasherId: "h-occasional" as string,
        eventId: e.id,
        eventDate: e.date,
      })),
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
    const records: AttendanceRecord[] = events.map((e) => ({
      kennelHasherId: "h1",
      eventId: e.id,
      eventDate: e.date,
    }));
    const input = makeInput({
      kennelEvents: events,
      attendanceRecords: records,
      rosterHasherIds: ["h1"],
    });

    const result1 = computeSuggestionScores(input, REF_DATE);
    const result2 = computeSuggestionScores(input, REF_DATE);

    expect(result1).toEqual(result2);
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

      const eventKennelMap = new Map<string, string>();
      for (const e of brooklynEvents) eventKennelMap.set(e.id, KENNEL_ID);
      for (const e of nycEvents) eventKennelMap.set(e.id, "kennel-nyc");

      // Hasher attended all 3 NYC events, 0 Brooklyn events
      const records: AttendanceRecord[] = nycEvents.map((e) => ({
        kennelHasherId: "hasher-nyc-only",
        eventId: e.id,
        eventDate: e.date,
      }));

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID, "kennel-nyc"],
          kennelEvents: brooklynEvents,
          rosterEvents,
          attendanceRecords: records,
          rosterHasherIds: ["hasher-nyc-only"],
          eventKennelMap,
        }),
        REF_DATE,
      );

      // Should be suggested (score > 0.3) via roster frequency
      expect(result).toHaveLength(1);
      expect(result[0].kennelHasherId).toBe("hasher-nyc-only");
      expect(result[0].score).toBeGreaterThan(SUGGESTION_THRESHOLD);
      // Kennel frequency is 0, roster frequency is 3/6 = 0.5
      expect(result[0].frequency).toBe(0);
      expect(result[0].rosterFrequency).toBe(0.5);
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

      const eventKennelMap = new Map<string, string>();
      for (const e of brooklynEvents) eventKennelMap.set(e.id, KENNEL_ID);
      for (const e of nycEvents) eventKennelMap.set(e.id, "kennel-nyc");

      const records: AttendanceRecord[] = [
        // brooklyn-regular attended all 3 Brooklyn events
        ...brooklynEvents.map((e) => ({
          kennelHasherId: "brooklyn-regular" as string,
          eventId: e.id,
          eventDate: e.date,
        })),
        // nyc-only attended all 3 NYC events, 0 Brooklyn
        ...nycEvents.map((e) => ({
          kennelHasherId: "nyc-only" as string,
          eventId: e.id,
          eventDate: e.date,
        })),
      ];

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID, "kennel-nyc"],
          kennelEvents: brooklynEvents,
          rosterEvents,
          attendanceRecords: records,
          rosterHasherIds: ["brooklyn-regular", "nyc-only"],
          eventKennelMap,
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
      // Hasher attended 3 of 6 events
      const records: AttendanceRecord[] = events.slice(0, 3).map((e) => ({
        kennelHasherId: "h1",
        eventId: e.id,
        eventDate: e.date,
      }));

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID], // single kennel
          kennelEvents: events,
          // rosterEvents defaults to kennelEvents via makeInput
          attendanceRecords: records,
          rosterHasherIds: ["h1"],
        }),
        REF_DATE,
      );

      expect(result).toHaveLength(1);
      // frequency = 3/6 = 0.5, rosterFrequency should equal frequency
      expect(result[0].frequency).toBe(0.5);
      expect(result[0].rosterFrequency).toBe(0.5);
    });

    it("MIN_EVENTS uses roster events for multi-kennel rosters", () => {
      // Brooklyn has only 1 event (below MIN=3), but roster has 4 total
      const brooklynEvents: KennelEvent[] = [{ id: "bk-1", date: daysAgo(7) }];
      const nycEvents: KennelEvent[] = Array.from({ length: 3 }, (_, i) => ({
        id: `nyc-${i}`,
        date: daysAgo(14 + i * 7),
      }));
      const rosterEvents = [...brooklynEvents, ...nycEvents];

      const eventKennelMap = new Map<string, string>();
      eventKennelMap.set("bk-1", KENNEL_ID);
      for (const e of nycEvents) eventKennelMap.set(e.id, "kennel-nyc");

      // Hasher attended all NYC events + the 1 Brooklyn event
      const records: AttendanceRecord[] = [
        { kennelHasherId: "h1", eventId: "bk-1", eventDate: daysAgo(7) },
        ...nycEvents.map((e) => ({
          kennelHasherId: "h1",
          eventId: e.id,
          eventDate: e.date,
        })),
      ];

      const result = computeSuggestionScores(
        makeInput({
          rosterKennelIds: [KENNEL_ID, "kennel-nyc"],
          kennelEvents: brooklynEvents,
          rosterEvents,
          attendanceRecords: records,
          rosterHasherIds: ["h1"],
          eventKennelMap,
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
