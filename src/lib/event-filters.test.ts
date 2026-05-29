import {
  DISPLAY_EVENT_WHERE,
  DISPLAYABLE_EVENT_NO_PARENT_WHERE,
  CANONICAL_EVENT_WHERE,
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
    const { parentEventId, ...expected } = DISPLAY_EVENT_WHERE;
    void parentEventId;
    expect(DISPLAYABLE_EVENT_NO_PARENT_WHERE).toEqual(expected);
  });
});

describe("CANONICAL_EVENT_WHERE", () => {
  it("constrains only to canonical rows", () => {
    expect(CANONICAL_EVENT_WHERE).toEqual({ isCanonical: true });
  });
});
