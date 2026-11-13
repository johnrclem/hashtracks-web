import { upcomingConfirmedEventWhere } from "@/lib/activity-status";
import {
  DISPLAY_EVENT_WHERE,
  DISPLAYABLE_EVENT_NO_PARENT_WHERE,
  CANONICAL_EVENT_WHERE,
  endsBefore,
  endsOnOrAfter,
  eventEndMs,
  HIDE_STOPPED_SCHEDULE_RUNS,
} from "@/lib/event-filters";

describe("DISPLAY_EVENT_WHERE", () => {
  it("excludes cancelled / manual / non-canonical / hidden-kennel / child rows", () => {
    expect(DISPLAY_EVENT_WHERE).toMatchObject({
      status: { not: "CANCELLED" },
      isManualEntry: { not: true },
      isCanonical: true,
      kennel: { isHidden: false },
      parentEventId: null,
    });
  });
});

describe("DISPLAY_EVENT_WHERE stopped kennels", () => {
  it("display filter hides schedule-only runs of stopped kennels", () => {
    expect(DISPLAY_EVENT_WHERE.NOT).toEqual({
      isScheduleOnly: true,
      kennel: { stoppedAt: { not: null } },
    });
    expect(DISPLAYABLE_EVENT_NO_PARENT_WHERE.NOT).toEqual(DISPLAY_EVENT_WHERE.NOT);
  });
});

describe("HIDE_STOPPED_SCHEDULE_RUNS", () => {
  it("is shared by every display where-builder", () => {
    expect(DISPLAY_EVENT_WHERE).toMatchObject(HIDE_STOPPED_SCHEDULE_RUNS);
    expect(DISPLAYABLE_EVENT_NO_PARENT_WHERE).toMatchObject(HIDE_STOPPED_SCHEDULE_RUNS);
    expect(upcomingConfirmedEventWhere(new Date())).toMatchObject(HIDE_STOPPED_SCHEDULE_RUNS);
  });
});

describe("DISPLAYABLE_EVENT_NO_PARENT_WHERE", () => {
  // Used by surfaces that address an event (or a series child) directly by id —
  // the detail-page child timeline and the crawlable per-event OG image route.
  // It MUST keep every public-visibility guard except `parentEventId` so that
  // private manual entries, cancelled trails, and non-canonical rows can never
  // render a polished social card, while legitimate child pages stay reachable.
  it("keeps the public-visibility guards", () => {
    expect(DISPLAYABLE_EVENT_NO_PARENT_WHERE).toMatchObject({
      status: { not: "CANCELLED" },
      isManualEntry: { not: true },
      isCanonical: true,
      kennel: { isHidden: false },
    });
  });

  it("drops only the parentEventId predicate (children stay addressable)", () => {
    expect(DISPLAYABLE_EVENT_NO_PARENT_WHERE).not.toHaveProperty("parentEventId");
  });

  it("is otherwise identical to DISPLAY_EVENT_WHERE", () => {
    const { parentEventId: _parentEventId, ...expected } = DISPLAY_EVENT_WHERE;
    expect(DISPLAYABLE_EVENT_NO_PARENT_WHERE).toEqual(expected);
  });
});

describe("CANONICAL_EVENT_WHERE", () => {
  it("constrains only to canonical rows", () => {
    expect(CANONICAL_EVENT_WHERE).toEqual({ isCanonical: true });
  });
});

describe("eventEndMs / endsOnOrAfter / endsBefore (#2452)", () => {
  it("uses endDate when set, else date", () => {
    expect(eventEndMs({ date: "2026-06-26T12:00:00.000Z", endDate: "2026-06-28T12:00:00.000Z" })).toBe(Date.UTC(2026, 5, 28, 12));
    expect(eventEndMs({ date: "2026-06-26T12:00:00.000Z", endDate: null })).toBe(Date.UTC(2026, 5, 26, 12));
  });

  it("builds end-aware where clauses", () => {
    const d = new Date("2026-06-27T00:00:00Z");
    expect(endsOnOrAfter(d)).toEqual({ OR: [{ date: { gte: d } }, { endDate: { gte: d } }] });
    expect(endsBefore(d)).toEqual({ date: { lt: d }, OR: [{ endDate: null }, { endDate: { lt: d } }] });
  });
});
