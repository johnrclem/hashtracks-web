import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetupAdapter, extractApolloEvents, resolveVenue, isNumericId, dedupByDate, stripTrailingState, deduplicateWords, isStateFullName, buildRawEventFromApollo, extractHaresFromMeetupDescription, cleanMeetupTitle, detectBoilerplateBlocks, stripBoilerplateBlocks, extractRunNumberFromMeetupDescription } from "./adapter";
import { normalizeDescriptionKey } from "../utils";
import { SOURCES } from "../../../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../safe-fetch";
const mockSafeFetch = vi.mocked(safeFetch);

function makeSource(config: unknown): Source {
  return {
    id: "src-1",
    config,
    url: "https://meetup.com/test-hash",
    type: "MEETUP",
  } as unknown as Source;
}

// `.fetch()` tests filter events through buildDateWindow (symmetric ±days), so
// static fixture dates eventually age out of the lower bound and turn main red
// on a rolling calendar date (Memory: feedback_windowed_adapter_test_needs_relative_dates).
// Use these now-relative helpers for any event a fetch test expects to survive
// the window. Pure-parse tests (buildRawEventFromApollo, dedupByDate, etc.) keep
// static dates — they never hit the window.
function isoDaysFromNow(days: number, time = "18:00", offset = "-05:00"): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 10)}T${time}:00${offset}`;
}
function dateDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Shared near-future date for the default fixture so the date-asserting test can
// recompute the expected value without re-deriving the offset.
const DEFAULT_EVENT_DAYS = 10;
// Shared near-future timestamp for the recurring-template / same-day dedup
// enrichment fetch tests (template + customized occurrence must land on the
// SAME calendar day for dedupByDate to collapse them).
const ENRICH_DAY = isoDaysFromNow(20, "11:00", "-04:00");

/** Build a minimal Apollo event object. */
function buildApolloEvent(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "Event",
    id: "313348941",
    title: "Trail #42 — Central Park",
    dateTime: isoDaysFromNow(DEFAULT_EVENT_DAYS, "18:00"),
    endTime: isoDaysFromNow(DEFAULT_EVENT_DAYS, "21:00"),
    status: "ACTIVE",
    description: "<p>Join us for a fun trail!</p>",
    eventUrl: "https://www.meetup.com/test-hash/events/313348941/",
    venue: { __ref: "Venue:123" },
    ...overrides,
  };
}

const VENUE_ENTRY = {
  __typename: "Venue",
  name: "Central Park Tavern",
  address: "100 W 67th St",
  city: "New York",
  state: "NY",
  lat: 40.7749,
  lng: -73.9754,
};

/** Wrap Apollo state entries into a realistic __NEXT_DATA__ HTML page. */
function buildMeetupHtml(
  stateEntries: Record<string, unknown>,
): string {
  const nextData = JSON.stringify({
    props: { pageProps: { __APOLLO_STATE__: stateEntries } },
  });
  return `<!DOCTYPE html>
<html><head><title>Meetup</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">${nextData}</script>
<div id="app"></div>
</body></html>`;
}

function mockHtmlResponse(html: string) {
  mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => html,
  } as unknown as Response);
}

/** Set up dual-response mock: different HTML for upcoming vs past Meetup pages, with optional detail pages. */
function mockDualPageFetch(upcomingHtml: string, pastHtml: string, detailPages?: Record<string, string>) {
  mockSafeFetch.mockImplementation(async (url: string) => {
    // Check detail pages first (most specific match)
    if (detailPages) {
      for (const [pattern, html] of Object.entries(detailPages)) {
        if (url.includes(pattern)) {
          return { ok: true, status: 200, text: async () => html } as unknown as Response;
        }
      }
    }
    const html = url.includes("?type=past") ? pastHtml : upcomingHtml;
    return { ok: true, status: 200, text: async () => html } as unknown as Response;
  });
}

/** Build a recurring template event (alphanumeric token ID + series field). */
function buildRecurringTemplate(overrides: Record<string, unknown> = {}) {
  return buildApolloEvent({
    id: "fpchvtyjcfbsb",
    title: "Saturday Trail!",
    description: "<p>Generic recurring event description</p>",
    eventUrl: "https://www.meetup.com/test-hash/events/fpchvtyjcfbsb/",
    series: { __ref: "EventSeries:123" },
    ...overrides,
  });
}

/** Build a customized occurrence event (numeric ID, no series field). */
function buildCustomizedOccurrence(overrides: Record<string, unknown> = {}) {
  return buildApolloEvent({
    id: "313480174",
    title: "SAVH3 Trail #1324!",
    description: "<p>Meet at Forsyth Park. Shiggy level: 3. Hares: Fast &amp; Loose</p>",
    eventUrl: "https://www.meetup.com/test-hash/events/313480174/",
    ...overrides,
  });
}

describe("extractApolloEvents", () => {
  it("extracts events from Apollo state HTML", () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ id: "1" }),
      "Event:2": buildApolloEvent({ id: "2", title: "Second Run" }),
      "Venue:123": VENUE_ENTRY,
      ROOT_QUERY: { __typename: "Query" },
    });
    const { events } = extractApolloEvents(html);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id)).toContain("1");
    expect(events.map((e) => e.id)).toContain("2");
  });

  it("returns empty array when no Apollo state found", () => {
    const { events } = extractApolloEvents("<html><body>No state here</body></html>");
    expect(events).toHaveLength(0);
  });

  it("returns empty array on malformed JSON", () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{broken json}</script>';
    const { events } = extractApolloEvents(html);
    expect(events).toHaveLength(0);
  });
});

describe("resolveVenue", () => {
  it("returns all parts for normal venue with distinct fields", () => {
    const state = { "Venue:1": { __typename: "Venue", name: "Central Park Tavern", address: "100 W 67th St", city: "New York", state: "NY", lat: 40.77, lng: -73.97 } };
    const result = resolveVenue(state, { __ref: "Venue:1" });
    expect(result.location).toBe("Central Park Tavern, 100 W 67th St, New York, NY");
  });

  it("deduplicates identical name and address (Miami case)", () => {
    const state = {};
    const result = resolveVenue(state, { name: "Miami Miami, FL", address: "Miami Miami, FL", city: "Florida", state: "FL" });
    expect(result.location).toBe("Miami, FL");
  });

  it("skips state when already present in name", () => {
    const state = {};
    const result = resolveVenue(state, { name: "Downtown Bar, NY", address: "123 Main St", city: "New York", state: "NY" });
    expect(result.location).toBe("Downtown Bar, 123 Main St, New York, NY");
  });

  it("skips city when it's a substring of prior parts", () => {
    const state = {};
    const result = resolveVenue(state, { name: "New York Pizza", address: "456 Broadway", city: "New York", state: "NY" });
    expect(result.location).toBe("New York Pizza, 456 Broadway, NY");
  });

  it("resolves __ref from Apollo state", () => {
    const state = { "Venue:42": { __typename: "Venue", name: "The Pub", city: "Boston", state: "MA" } };
    const result = resolveVenue(state, { __ref: "Venue:42" });
    expect(result.location).toBe("The Pub, Boston, MA");
  });

  it("returns empty object for null venue", () => {
    expect(resolveVenue({}, null)).toEqual({});
  });

  it("returns empty object for unresolvable __ref", () => {
    expect(resolveVenue({}, { __ref: "Venue:999" })).toEqual({});
  });

  it("deduplicates address case-insensitively", () => {
    const state = {};
    const result = resolveVenue(state, { name: "The Pub", address: "the pub", city: "Boston", state: "MA" });
    expect(result.location).toBe("The Pub, Boston, MA");
  });

  it("extracts lat/lng from resolved venue", () => {
    const state = { "Venue:1": { __typename: "Venue", name: "Pub", lat: 25.76, lng: -80.19 } };
    const result = resolveVenue(state, { __ref: "Venue:1" });
    expect(result.latitude).toBe(25.76);
    expect(result.longitude).toBe(-80.19);
  });

  it("filters 'Maps' venue name artifact", () => {
    const state = {
      "Venue:123": { __typename: "Venue", name: "Maps", address: "64A Market St", city: "Portland", state: "ME", lat: 43.66, lng: -70.26 },
    };
    const result = resolveVenue(state, { __ref: "Venue:123" } as never);
    expect(result.location).not.toContain("Maps,");
    expect(result.location).toBe("64A Market St, Portland, ME");
  });

  it("skips compound-address venue name when address is a prefix of name", () => {
    const result = resolveVenue({}, {
      name: "13480 Congress Lake Avenue, Hartville, 44632",
      address: "13480 Congress Lake Avenue",
      city: "Hartville",
      state: "OH",
      lat: 40.978622,
      lng: -81.31964,
    } as never);
    expect(result.location).toBe("13480 Congress Lake Avenue, Hartville, OH");
  });

  it("deduplicates self-concatenated address fields and skips redundant address in name", () => {
    const result = resolveVenue({}, {
      name: "410 E 35th Street Parking Lot",
      address: "410 E 35th Street410 E 35th St",
      city: "Charlotte",
      state: "NC",
    } as never);
    expect(result.location).not.toContain("Street410");
    // Address should be dropped since name already contains the street
    expect(result.location).toBe("410 E 35th Street Parking Lot, Charlotte, NC");
  });

  it("keeps real venue name when it differs from address", () => {
    const result = resolveVenue({}, {
      name: "Quail Hollow Park",
      address: "13480 Congress Lake Ave NE",
      city: "Hartville",
      state: "OH",
    } as never);
    expect(result.location).toBe("Quail Hollow Park, 13480 Congress Lake Ave NE, Hartville, OH");
  });
});

describe("stripTrailingState", () => {
  it("strips trailing state abbreviation", () => {
    expect(stripTrailingState("Miami Miami, FL", "FL")).toBe("Miami Miami");
  });

  it("strips trailing full state name", () => {
    expect(stripTrailingState("Miami Miami, Florida", "FL")).toBe("Miami Miami");
  });

  it("no-op when no state match", () => {
    expect(stripTrailingState("Central Park Tavern", "NY")).toBe("Central Park Tavern");
  });

  it("returns original if stripping would empty the string", () => {
    expect(stripTrailingState(", FL", "FL")).toBe(", FL");
  });

  it("returns original when stateAbbrev is undefined", () => {
    expect(stripTrailingState("Some Place, FL", undefined)).toBe("Some Place, FL");
  });
});

describe("deduplicateWords", () => {
  it("collapses doubled single word", () => {
    expect(deduplicateWords("Miami Miami")).toBe("Miami");
  });

  it("collapses doubled multi-word phrase", () => {
    expect(deduplicateWords("New York New York")).toBe("New York");
  });

  it("collapses triple consecutive word (loop fix)", () => {
    expect(deduplicateWords("Miami Miami Miami")).toBe("Miami");
  });

  it("preserves normal text", () => {
    expect(deduplicateWords("Central Park Tavern")).toBe("Central Park Tavern");
  });
});

describe("isStateFullName", () => {
  it("returns true for non-ambiguous state name", () => {
    expect(isStateFullName("Florida")).toBe(true);
    expect(isStateFullName("California")).toBe(true);
    expect(isStateFullName("  florida  ")).toBe(true);
  });

  it("returns false for ambiguous city/state names", () => {
    expect(isStateFullName("New York")).toBe(false);
    expect(isStateFullName("Washington")).toBe(false);
    expect(isStateFullName("Georgia")).toBe(false);
  });

  it("returns false for non-state names", () => {
    expect(isStateFullName("Miami")).toBe(false);
    expect(isStateFullName("Chicago")).toBe(false);
  });
});

describe("resolveVenue — name cleanup integration", () => {
  it("cleans full Miami corrupt venue to 'Miami, FL'", () => {
    const result = resolveVenue({}, { name: "Miami Miami, FL", address: "Miami Miami, FL", city: "Florida", state: "FL" });
    expect(result.location).toBe("Miami, FL");
  });

  it("strips full state name from venue name", () => {
    const result = resolveVenue({}, { name: "Bar Name, California", address: "123 Main St", city: "Los Angeles", state: "CA" });
    expect(result.location).toBe("Bar Name, 123 Main St, Los Angeles, CA");
  });

  it("preserves normal venue (no regression)", () => {
    const state = { "Venue:1": { __typename: "Venue", name: "Central Park Tavern", address: "100 W 67th St", city: "New York", state: "NY", lat: 40.77, lng: -73.97 } };
    const result = resolveVenue(state, { __ref: "Venue:1" });
    expect(result.location).toBe("Central Park Tavern, 100 W 67th St, New York, NY");
  });

  it("does not mangle legitimate repeated-word venue names like 'Walla Walla Brewing Co'", () => {
    // deduplicateWords should not be applied when no corruption signal (state not embedded in name)
    const result = resolveVenue({}, { name: "Walla Walla Brewing Co", city: "Walla Walla", state: "WA" });
    expect(result.location).toBe("Walla Walla Brewing Co, WA");
  });

  it("preserves city when it is a state name but for a different state (e.g. California, MO)", () => {
    // "California" is a city in Missouri — should not be suppressed just because it's also a state name
    const result = resolveVenue({}, { name: "Some Bar", city: "California", state: "MO" });
    expect(result.location).toBe("Some Bar, California, MO");
  });
});

describe("MeetupAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error for invalid config", async () => {
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(makeSource(null));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.events).toHaveLength(0);
  });

  it("returns error for missing groupUrlname", async () => {
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(makeSource({ kennelTag: "NYCH3" }));
    expect(result.errors[0]).toMatch(/groupUrlname/i);
  });

  it("returns error on non-ok HTTP response", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      status: 404,
    } as unknown as Response);
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/404/);
  });

  it("returns error on fetch failure", async () => {
    mockSafeFetch.mockRejectedValue(new Error("Network error"));
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/Network error/);
  });

  it("filters out cancelled events (#917 Charlotte H3 #1235)", async () => {
    // Charlotte H3 Trail #1235 (Jan 10) was cancelled on Meetup with
    // status="CANCELLED", then re-held on Feb 7 with the same trail
    // number but a new title. The adapter must not surface the cancelled
    // version as a normal past run, otherwise users see two #1235 cards
    // and no cancellation indicator on the first.
    const html = buildMeetupHtml({
      "Event:cancelled": buildApolloEvent({
        id: "1235-cancelled",
        title: "Charlotte H3 Trail #1235 - Erections (Elections) & SOUP Cook off",
        dateTime: isoDaysFromNow(20, "14:00"),
        status: "CANCELLED",
      }),
      "Event:active": buildApolloEvent({
        id: "1235-active",
        title: "Charlotte H3 Trail #1235 - An East Charlotte Snow Melt Trail!",
        dateTime: isoDaysFromNow(30, "14:00"),
        status: "ACTIVE",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "charlotte-hash-house-harriers", kennelTag: "ch3-nc" }),
      { days: 365 },
    );

    // Cancelled event should be skipped; only the active one survives.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toMatch(/Snow Melt/);
    expect(result.diagnosticContext?.cancelledSkipped).toBe(1);
  });

  it("filters out admin-notice posts (#1689 Narwhal H3)", async () => {
    // Narwhal H3 fully migrated off Meetup to cthashing.com and posted a
    // farewell event titled "Moving to a new website site - Last day in
    // Meetup is March 10th". ADMIN_NOTICE_PATTERNS (shared with FB hosted
    // events, PR #1527) must drop this kind of post.
    const html = buildMeetupHtml({
      "Event:admin": buildApolloEvent({
        id: "313638944",
        title: "Moving to a new website site - Last day in Meetup is March 10th",
        dateTime: isoDaysFromNow(20, "07:00"),
        status: "ACTIVE",
      }),
      "Event:trail": buildApolloEvent({
        id: "real-trail",
        title: "Narwhal H3 #54 - Real Trail",
        dateTime: isoDaysFromNow(25, "13:00"),
        status: "ACTIVE",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "meetup-group-cwrnpwpc", kennelTag: "narwhal-h3" }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toMatch(/Real Trail/);
    expect(result.diagnosticContext?.adminNoticeSkipped).toBe(1);
  });

  it("filters Miami's 'LEAVING MEETUP' departure notice and audit-logs it (#1728)", async () => {
    // Miami H3 posted a dummy event titled "MIAMI HASH HOUSE HARRIERS ARE
    // LEAVING MEETUP" to announce the platform departure. The new narrow
    // /\bleaving\s+meetup\b/i pattern drops it; the dropped title is surfaced
    // in diagnosticContext for admin false-positive review.
    const html = buildMeetupHtml({
      "Event:departure": buildApolloEvent({
        id: "314543422",
        title: "MIAMI HASH HOUSE HARRIERS ARE LEAVING MEETUP",
        dateTime: isoDaysFromNow(20, "18:00", "-04:00"),
        status: "ACTIVE",
      }),
      "Event:leavingLasVegas": buildApolloEvent({
        id: "real-trail",
        title: "Leaving Las Vegas Trail #42",
        dateTime: isoDaysFromNow(25, "18:00", "-04:00"),
        status: "ACTIVE",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "miami-hash-house-harriers", kennelTag: "mia-h3" }),
      { days: 365 },
    );

    // Departure notice dropped; a bare-"leaving" trail title is kept (narrow pattern).
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toMatch(/Leaving Las Vegas/);
    expect(result.diagnosticContext?.adminNoticeSkipped).toBe(1);
    expect(result.diagnosticContext?.adminNoticeTitles).toEqual([
      "MIAMI HASH HOUSE HARRIERS ARE LEAVING MEETUP",
    ]);
  });

  it("keeps run-numbered farewell/goodbye trails (#1739 negative fixture)", async () => {
    // The retrofit gates the broad farewell words ("farewell"/"goodbye") with a
    // hash-signal check, so a real departing-hasher "Farewell Run" / "Goodbye
    // Trail" that carries a run number still ingests — only un-signalled
    // platform-departure posts drop. Without the gate these would be dropped as
    // false positives (the exact case .claude required a negative fixture for).
    const html = buildMeetupHtml({
      "Event:farewell": buildApolloEvent({
        id: "fw1",
        title: "Farewell Run Trail #42",
        dateTime: isoDaysFromNow(20, "18:00", "-04:00"),
        status: "ACTIVE",
      }),
      "Event:goodbye": buildApolloEvent({
        id: "gb1",
        title: "Goodbye Trail #138",
        dateTime: isoDaysFromNow(25, "18:00", "-04:00"),
        status: "ACTIVE",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "narwhal-h3-group", kennelTag: "narwhal-h3" }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(2);
    expect(result.events.some((e) => /Farewell/i.test(e.title ?? ""))).toBe(true);
    expect(result.events.some((e) => /Goodbye/i.test(e.title ?? ""))).toBe(true);
    expect(result.diagnosticContext?.adminNoticeSkipped).toBe(0);
  });

  // ── #2058/#2059/#2062: group-template boilerplate leak ──
  // Meetup stores a kennel's standing recurring-event template as EVERY
  // occurrence's description, displacing run-specific notes. The structural
  // signal is verbatim repetition across the group's events; genuine per-event
  // notes appear once. Boilerplate → `description: null` (explicit clear);
  // unique content survives untouched.

  it("drops group-template boilerplate description repeated across events (#2058/#2059/#2062)", async () => {
    // Montreal-style standing template reused verbatim on every occurrence.
    const TEMPLATE =
      "<p>Structure: This event will be a run/walk, followed by a social gathering with food and drinks. Don't Arrive Late! What Are The Hash House Harriers?</p>";
    const html = buildMeetupHtml({
      "Event:1683": buildApolloEvent({
        id: "1683",
        title: "MH3 Run #1683",
        dateTime: isoDaysFromNow(20, "13:00"),
        description: TEMPLATE,
      }),
      "Event:1684": buildApolloEvent({
        id: "1684",
        title: "MH3 Run #1684",
        dateTime: isoDaysFromNow(27, "13:00"),
        description: TEMPLATE,
      }),
      "Event:1685": buildApolloEvent({
        id: "1685",
        title: "MH3 Run #1685",
        dateTime: isoDaysFromNow(34, "13:00"),
        description: TEMPLATE,
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "montreal-hash-house-harriers", kennelTag: "mh3-ca" }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(3);
    // Every event's boilerplate description is cleared to null (explicit clear,
    // per merge.ts UPDATE contract — wipes the stored template).
    for (const ev of result.events) {
      expect(ev.description).toBeNull();
    }
    expect(result.diagnosticContext?.boilerplateDescriptionsDropped).toBe(3);
  });

  it("keeps a genuine per-event description while dropping the repeated template (negative fixture)", async () => {
    const TEMPLATE =
      "<p>Join us for our weekly hashing trail! Event details are posted by Thursday before trail. Savannah Hash House Harriers is a social running club.</p>";
    const html = buildMeetupHtml({
      // Two occurrences carry the standing template verbatim → boilerplate.
      "Event:t1": buildApolloEvent({
        id: "t1",
        title: "Saturday Trail!",
        dateTime: isoDaysFromNow(14, "15:00"),
        description: TEMPLATE,
      }),
      "Event:t2": buildApolloEvent({
        id: "t2",
        title: "Saturday Trail!",
        dateTime: isoDaysFromNow(21, "15:00"),
        description: TEMPLATE,
      }),
      // One occurrence has real run-specific notes → must survive untouched.
      "Event:real": buildApolloEvent({
        id: "real",
        title: "SAVH3 Trail #1324!",
        dateTime: isoDaysFromNow(28, "15:00"),
        description: "<p>Meet at Forsyth Park. Theme: pirates. On-after at the Rail Pub.</p>",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "savannah-hash-house-harriers", kennelTag: "savh3" }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(3);
    const real = result.events.find((e) => e.title === "SAVH3 Trail #1324!");
    expect(real?.description).toBe(
      "Meet at Forsyth Park. Theme: pirates. On-after at the Rail Pub.",
    );
    const templated = result.events.filter((e) => e.title === "Saturday Trail!");
    expect(templated).toHaveLength(2);
    for (const ev of templated) expect(ev.description).toBeNull();
    expect(result.diagnosticContext?.boilerplateDescriptionsDropped).toBe(2);
  });

  it("keeps a one-off description that never repeats (no false positive)", async () => {
    const html = buildMeetupHtml({
      "Event:a": buildApolloEvent({
        id: "a",
        title: "Trail A",
        dateTime: isoDaysFromNow(14, "18:00"),
        description: "<p>Unique notes for trail A — bring a headlamp.</p>",
      }),
      "Event:b": buildApolloEvent({
        id: "b",
        title: "Trail B",
        dateTime: isoDaysFromNow(21, "18:00"),
        description: "<p>Different notes for trail B — wear costumes.</p>",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.description !== null && e.description !== undefined)).toBe(true);
    expect(result.diagnosticContext?.boilerplateDescriptionsDropped).toBe(0);
  });

  // ── #2228: keepRepeatedDescription opt-out ──
  // Paris H3 / Sans Clue H3 publish the SAME emoji run template on every event;
  // the default detector would strip it as boilerplate and leave only a
  // title-echo. With the opt-out, the full body is kept verbatim.
  it("keeps repeated template descriptions when keepRepeatedDescription is set (#2228 Sans Clue)", async () => {
    const TEMPLATE =
      "🐰 Hares: TBD\n👣 Trail: A-to-B trail, no bag drop\n💶 Hash Cash: 5 €";
    const html = buildMeetupHtml({
      "Event:1193": buildApolloEvent({
        id: "1193",
        title: "Sans Clue H3 R*n 1193 | TBD",
        dateTime: isoDaysFromNow(14, "14:00", "+02:00"),
        description: `**Sans Clue H3 R\\*n 1193 \\| TBD**\n\n${TEMPLATE}`,
      }),
      "Event:1194": buildApolloEvent({
        id: "1194",
        title: "Sans Clue H3 R*n 1194 | TBD",
        dateTime: isoDaysFromNow(28, "14:00", "+02:00"),
        description: `**Sans Clue H3 R\\*n 1194 \\| TBD**\n\n${TEMPLATE}`,
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "parish3-schhh", kennelTag: "sans-clue-h3", keepRepeatedDescription: true }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(2);
    // The full emoji body survives (not stripped to a title-echo).
    for (const ev of result.events) {
      expect(ev.description).toContain("Hash Cash: 5 €");
      expect(ev.description).toContain("Hares: TBD");
    }
    expect(result.diagnosticContext?.boilerplateDescriptionsDropped).toBe(0);
  });

  it("still strips repeated boilerplate when keepRepeatedDescription is absent (default unchanged)", async () => {
    const TEMPLATE = "🐰 Hares: TBD\n👣 Trail: A-to-B trail\n💶 Hash Cash: 5 €";
    const html = buildMeetupHtml({
      "Event:x1": buildApolloEvent({
        id: "x1",
        title: "Run #1",
        dateTime: isoDaysFromNow(14, "14:00"),
        description: TEMPLATE,
      }),
      "Event:x2": buildApolloEvent({
        id: "x2",
        title: "Run #2",
        dateTime: isoDaysFromNow(28, "14:00"),
        description: TEMPLATE,
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(2);
    for (const ev of result.events) expect(ev.description).toBeNull();
    expect(result.diagnosticContext?.boilerplateDescriptionsDropped).toBe(2);
  });

  it("strips a shared club paragraph but keeps the per-event logistics stanza (#2059 Hogtown)", async () => {
    // Hogtown prepends the same club blurb to a per-event Date/Cost stanza, so
    // the WHOLE description differs per event but the club paragraph repeats.
    const CLUB =
      "Hogtown Hash House Harriers (HH3) is a Toronto social running and beer drinking group. New members welcome!";
    const html = buildMeetupHtml({
      "Event:h1": buildApolloEvent({
        id: "h1",
        title: "Thursday run/walk with HH3",
        dateTime: isoDaysFromNow(14, "19:00", "-04:00"),
        description: `${CLUB}\n\nDate / Time: Thursday @ 7pm. Start: Christie Pits. Cost: $10.`,
      }),
      "Event:h2": buildApolloEvent({
        id: "h2",
        title: "Saturday run/walk with HH3",
        dateTime: isoDaysFromNow(23, "15:00", "-04:00"),
        description: `${CLUB}\n\nDate / Time: Saturday @ 3pm. Start: High Park. Cost: $15.`,
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "meetup-group-pyrddkbc", kennelTag: "hogtownh3" }),
      { days: 365 },
    );

    expect(result.events).toHaveLength(2);
    const h1 = result.events.find((e) => e.title === "Thursday run/walk with HH3");
    const h2 = result.events.find((e) => e.title === "Saturday run/walk with HH3");
    // Club blurb removed; per-event logistics survive.
    expect(h1?.description).toBe("Date / Time: Thursday @ 7pm. Start: Christie Pits. Cost: $10.");
    expect(h2?.description).toBe("Date / Time: Saturday @ 3pm. Start: High Park. Cost: $15.");
    expect(h1?.description).not.toContain("social running");
    expect(result.diagnosticContext?.boilerplateDescriptionsDropped).toBe(2);
  });

  it("parses events and assigns kennelTag", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events.length).toBe(1);
    expect(result.events[0].kennelTags[0]).toBe("NYCH3");
    expect(result.events[0].title).toBe("Trail #42 — Central Park");
    expect(result.events[0].date).toBe(dateDaysFromNow(DEFAULT_EVENT_DAYS));
    expect(result.events[0].startTime).toBe("18:00");
    expect(result.events[0].endTime).toBe("21:00");
  });

  it("builds location from venue ref", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].location).toBe("Central Park Tavern, 100 W 67th St, New York, NY");
  });

  it("extracts lat/lng from venue", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].latitude).toBe(40.7749);
    expect(result.events[0].longitude).toBe(-73.9754);
  });

  it("handles inline venue (no __ref)", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({
        venue: { name: "Some Bar", city: "Brooklyn" },
      }),
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].location).toBe("Some Bar, Brooklyn");
  });

  it("handles null venue", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ venue: null }),
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].location).toBeUndefined();
  });

  it("strips HTML tags from description", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].description).toBe("Join us for a fun trail!");
  });

  // #1659: Meetup's Apollo cache deduplicates long shared strings (like the
  // boilerplate "Structure / This event..." block reused across every MH3
  // Montreal event) by storing a bare back-reference like "$44" on the Event
  // entry, with the prose target stored separately under the same key in
  // __APOLLO_STATE__. Until #1659, the adapter passed the bare ref through to
  // canonical Event.description verbatim, producing the visible pattern
  // (run #1683 -> "$44", #1684 -> "$43", ...). Regression shapes below.
  it("resolves Apollo back-reference description to its target when state has it", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ description: "$44" }),
      "Venue:123": VENUE_ENTRY,
      $44: "Structure / This event will be a run/walk, followed by a social gathering at a nearby venue. All are welcome — hashers and virgins alike.",
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].description).toBe(
      "Structure / This event will be a run/walk, followed by a social gathering at a nearby venue. All are welcome — hashers and virgins alike.",
    );
  });

  it("preserves existing description (undefined) when Apollo back-reference doesn't resolve", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ description: "$44" }),
      "Venue:123": VENUE_ENTRY,
      // No $44 entry in state -> unresolvable.
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    // undefined (preserve existing) is the adapter convention — never let the
    // raw "$44" string persist, but don't clear legitimately stored prose
    // either. Reviewer feedback on PR #1688 (gemini-code-assist + codex P1):
    // prefer undefined over null in adapters.
    expect(result.events[0].description).toBeUndefined();
  });

  it("accepts short non-English back-reference targets (no English-prose heuristic)", async () => {
    // Reviewer feedback (PR #1688): an earlier `looksLikeProse` guard required
    // ≥20 chars + ASCII letters, which would drop short or non-Latin
    // descriptions. The fix is that resolveApolloDescriptionRef accepts any
    // string the chain bottoms out on. Verify with a short French/Japanese
    // string that the prior heuristic would have rejected.
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ description: "$44" }),
      "Venue:123": VENUE_ENTRY,
      $44: "ハッシュラン",
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].description).toBe("ハッシュラン");
  });

  it("follows chained Apollo back-references to the final target", async () => {
    // Real Apollo state can hop through multiple dedup layers — $44 → $45 →
    // wrapped { value: "actual prose" }. Without chain following, a perfectly
    // good description would get dropped (Codex finding on the
    // cleanMeetupDescription fix). Anchor a 3-hop chain in regression tests.
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ description: "$44" }),
      "Venue:123": VENUE_ENTRY,
      $44: "$45",
      $45: { value: "Trail #42 — pace yourself, watch for falsies, BYO drink." },
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].description).toBe(
      "Trail #42 — pace yourself, watch for falsies, BYO drink.",
    );
  });

  it("rejects a cyclic Apollo ref chain rather than looping forever", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ description: "$44" }),
      "Venue:123": VENUE_ENTRY,
      $44: "$45",
      $45: "$44", // pathological loop
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].description).toBeUndefined();
  });

  it("keeps far-future upcoming events beyond the forward window (#2195 Rubber City)", async () => {
    const futureIso = isoDaysFromNow(200);

    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Event:2": buildApolloEvent({
        id: "far-future",
        title: "Far Future Run",
        dateTime: futureIso,
        eventUrl: "https://www.meetup.com/test-hash/events/far-future/",
      }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 90 },
    );
    // The far-future (200-day) upcoming event is NO LONGER clipped by maxDate —
    // the upcoming feed is self-bounding and reconcile-safe (#2195).
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.title)).toContain("Far Future Run");
  });

  it("skips events without dateTime", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent({ dateTime: undefined }),
      "Event:2": buildApolloEvent({ id: "2", title: "Valid Run" }),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Valid Run");
  });

  it("includes sourceUrl from eventUrl", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].sourceUrl).toBe("https://www.meetup.com/test-hash/events/313348941/");
  });

  it("populates diagnosticContext", async () => {
    const html = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.diagnosticContext?.groupUrlname).toBe("test-hash");
    expect(result.diagnosticContext?.eventsFound).toBe(1);
  });

  it("reports error when no Apollo state found in HTML", async () => {
    const noStateHtml = "<html><body>No events here</body></html>";
    mockDualPageFetch(noStateHtml, noStateHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/Apollo state/);
    expect(result.errors[0]).toMatch(/page structure/);
  });

  it("uses safeFetch with correct URL", async () => {
    const html = buildMeetupHtml({ "Event:1": buildApolloEvent() });
    mockHtmlResponse(html);

    const adapter = new MeetupAdapter();
    await adapter.fetch(
      makeSource({ groupUrlname: "savannah-hash-house-harriers", kennelTag: "SavH3" }),
      { days: 365 },
    );
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://www.meetup.com/savannah-hash-house-harriers/events/",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("fetches both upcoming and past pages", async () => {
    const html = buildMeetupHtml({ "Event:1": buildApolloEvent() });
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as unknown as Response);

    const adapter = new MeetupAdapter();
    await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://www.meetup.com/test-hash/events/",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://www.meetup.com/test-hash/events/?type=past",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("combines events from both upcoming and past pages", async () => {
    const futureEvent = buildApolloEvent({ id: "future-1", title: "Upcoming Run", dateTime: isoDaysFromNow(20) });
    const pastEvent = buildApolloEvent({ id: "past-1", title: "Past Run", dateTime: isoDaysFromNow(-20) });

    const upcomingHtml = buildMeetupHtml({ "Event:future-1": futureEvent, "Venue:123": VENUE_ENTRY });
    const pastHtml = buildMeetupHtml({ "Event:past-1": pastEvent, "Venue:123": VENUE_ENTRY });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(2);
    const titles = result.events.map((e) => e.title);
    expect(titles).toContain("Upcoming Run");
    expect(titles).toContain("Past Run");
  });

  it("continues with upcoming-only when past page fetch fails", async () => {
    const upcomingHtml = buildMeetupHtml({
      "Event:1": buildApolloEvent(),
      "Venue:123": VENUE_ENTRY,
    });

    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes("?type=past")) {
        throw new Error("Network timeout");
      }
      return { ok: true, status: 200, text: async () => upcomingHtml } as unknown as Response;
    });

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("deduplicates events by id (upcoming takes priority)", async () => {
    const event = buildApolloEvent({ id: "shared-1", title: "Upcoming Version" });
    const pastEvent = buildApolloEvent({ id: "shared-1", title: "Past Version" });

    const upcomingHtml = buildMeetupHtml({ "Event:shared-1": event, "Venue:123": VENUE_ENTRY });
    const pastHtml = buildMeetupHtml({ "Event:shared-1": pastEvent, "Venue:123": VENUE_ENTRY });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Upcoming Version");
  });

  it("includes all past-page events regardless of age (exempt from minDate)", async () => {
    const oldPastDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const oldPastIso = oldPastDate.toISOString().slice(0, 19) + "-05:00";
    const recentPastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const recentPastIso = recentPastDate.toISOString().slice(0, 19) + "-05:00";

    const oldEvent = buildApolloEvent({ id: "old-1", title: "Old Event", dateTime: oldPastIso });
    const recentEvent = buildApolloEvent({ id: "recent-1", title: "Recent Event", dateTime: recentPastIso });

    const upcomingHtml = buildMeetupHtml({});
    const pastHtml = buildMeetupHtml({
      "Event:old-1": oldEvent,
      "Event:recent-1": recentEvent,
      "Venue:123": VENUE_ENTRY,
    });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 90 },
    );
    // Both past events included — past-only events exempt from minDate
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.title)).toContain("Old Event");
    expect(result.events.map((e) => e.title)).toContain("Recent Event");
  });

  it("includes per-page counts in diagnosticContext", async () => {
    const futureEvent = buildApolloEvent({ id: "future-1", dateTime: isoDaysFromNow(20) });
    const pastEvent = buildApolloEvent({ id: "past-1", dateTime: isoDaysFromNow(-20) });

    const upcomingHtml = buildMeetupHtml({ "Event:future-1": futureEvent, "Venue:123": VENUE_ENTRY });
    const pastHtml = buildMeetupHtml({ "Event:past-1": pastEvent, "Venue:123": VENUE_ENTRY });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.diagnosticContext?.upcomingEventsFound).toBe(1);
    expect(result.diagnosticContext?.pastEventsFound).toBe(1);
    expect(result.diagnosticContext?.eventsFound).toBe(2);
  });

  it("deduplicates template and customized occurrence on same date", async () => {
    const template = buildRecurringTemplate({ dateTime: ENRICH_DAY });
    const customized = buildCustomizedOccurrence({ dateTime: ENRICH_DAY });

    const upcomingHtml = buildMeetupHtml({
      "Event:fpchvtyjcfbsb": template,
      "Event:313480174": customized,
      "Venue:123": VENUE_ENTRY,
    });
    mockDualPageFetch(upcomingHtml, buildMeetupHtml({}));

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "SavH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("SAVH3 Trail #1324!");
  });

  it("enriches recurring event from detail page", async () => {
    const template = buildRecurringTemplate({ dateTime: ENRICH_DAY });
    const detailEvent = buildApolloEvent({
      id: "fpchvtyjcfbsb",
      title: "SAVH3 Trail #1324 — Forsyth Park!",
      description: "<p>Detailed hare info and shiggy level</p>",
      dateTime: ENRICH_DAY,
    });

    const upcomingHtml = buildMeetupHtml({
      "Event:fpchvtyjcfbsb": template,
      "Venue:123": VENUE_ENTRY,
    });
    const detailHtml = buildMeetupHtml({
      "Event:fpchvtyjcfbsb": detailEvent,
    });

    mockDualPageFetch(upcomingHtml, buildMeetupHtml({}), {
      "events/fpchvtyjcfbsb": detailHtml,
    });

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "SavH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("SAVH3 Trail #1324 — Forsyth Park!");
    expect(result.events[0].description).toBe("Detailed hare info and shiggy level");
  });

  it("does not enrich from detail page when event ID does not match", async () => {
    const template = buildRecurringTemplate({ dateTime: ENRICH_DAY });
    // Detail page contains a different event ID — should NOT be used for enrichment
    const unrelatedEvent = buildApolloEvent({
      id: "unrelated-999",
      title: "Wrong Event Title",
      description: "<p>Wrong event data</p>",
      dateTime: ENRICH_DAY,
    });

    const upcomingHtml = buildMeetupHtml({
      "Event:fpchvtyjcfbsb": template,
      "Venue:123": VENUE_ENTRY,
    });
    const detailHtml = buildMeetupHtml({
      "Event:unrelated-999": unrelatedEvent,
    });

    mockDualPageFetch(upcomingHtml, buildMeetupHtml({}), {
      "events/fpchvtyjcfbsb": detailHtml,
    });

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "SavH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    // Should keep the original template data, NOT the unrelated event's data
    expect(result.events[0].title).toBe("Saturday Trail!");
    expect(result.events[0].description).toBe("Generic recurring event description");
  });

  it("falls back to list data when detail page fetch fails", async () => {
    const template = buildRecurringTemplate({ dateTime: ENRICH_DAY });

    const upcomingHtml = buildMeetupHtml({
      "Event:fpchvtyjcfbsb": template,
      "Venue:123": VENUE_ENTRY,
    });

    mockSafeFetch.mockImplementation(async (url: string) => {
      if (url.includes("events/fpchvtyjcfbsb")) {
        throw new Error("Network timeout");
      }
      if (url.includes("?type=past")) {
        return { ok: true, status: 200, text: async () => buildMeetupHtml({}) } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => upcomingHtml } as unknown as Response;
    });

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "SavH3" }),
      { days: 365 },
    );
    // Should still emit the event with template data (non-fatal)
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Saturday Trail!");
  });

  it("skips detail page fetch for non-recurring events", async () => {
    const normalEvent = buildApolloEvent({ dateTime: ENRICH_DAY });

    const upcomingHtml = buildMeetupHtml({
      "Event:1": normalEvent,
      "Venue:123": VENUE_ENTRY,
    });
    mockDualPageFetch(upcomingHtml, buildMeetupHtml({}));

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "SavH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    // Only 2 fetches: upcoming + past (no detail page)
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(result.diagnosticContext?.detailPagesFetched).toBe(0);
  });

  it("no error when events exist but are all outside date window (Cleveland H4 scenario)", async () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const oldIso = oldDate.toISOString().slice(0, 19) + "-05:00";

    // Upcoming page has valid Apollo state but no Event entries
    const upcomingHtml = buildMeetupHtml({ ROOT_QUERY: { __typename: "Query" } });
    const pastHtml = buildMeetupHtml({
      "Event:old-1": buildApolloEvent({ id: "old-1", title: "Old Event", dateTime: oldIso }),
      "Venue:123": VENUE_ENTRY,
    });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "cleveland-h4", kennelTag: "CleH4" }),
      { days: 90 },
    );
    // Past event is included (exempt from minDate), and no errors
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Old Event");
    expect(result.errors).toHaveLength(0);
  });

  it("valid empty group (Apollo state exists but no events) is not an error", async () => {
    const upcomingHtml = buildMeetupHtml({
      ROOT_QUERY: { __typename: "Query" },
      "GroupByUrlname:test": { __typename: "Group", id: "12345" },
    });
    const pastHtml = buildMeetupHtml({
      ROOT_QUERY: { __typename: "Query" },
    });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "new-empty-group", kennelTag: "NewH3" }),
      { days: 90 },
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.errorDetails).toBeUndefined();
  });

  it("past exempt from minDate; upcoming exempt from maxDate but keeps its minDate floor (#2195)", async () => {
    const veryOldIso = isoDaysFromNow(-365);
    const farFutureIso = isoDaysFromNow(200);
    const nearFutureIso = isoDaysFromNow(10);

    const pastEvent = buildApolloEvent({ id: "past-365", title: "Year Old Event", dateTime: veryOldIso });
    const farFutureEvent = buildApolloEvent({ id: "far-future", title: "Far Future", dateTime: farFutureIso, eventUrl: "https://www.meetup.com/test-hash/events/far-future/" });
    const nearFutureEvent = buildApolloEvent({ id: "near-future", title: "Near Future", dateTime: nearFutureIso, eventUrl: "https://www.meetup.com/test-hash/events/near-future/" });
    // Contrived: a deep-past event surfaced on the UPCOMING page — must be
    // dropped by the upcoming-side minDate floor (the one bound still enforced).
    const stalePastUpcoming = buildApolloEvent({ id: "stale-up", title: "Stale Upcoming", dateTime: veryOldIso, eventUrl: "https://www.meetup.com/test-hash/events/stale-up/" });

    const upcomingHtml = buildMeetupHtml({
      "Event:far-future": farFutureEvent,
      "Event:near-future": nearFutureEvent,
      "Event:stale-up": stalePastUpcoming,
      "Venue:123": VENUE_ENTRY,
    });
    const pastHtml = buildMeetupHtml({
      "Event:past-365": pastEvent,
      "Venue:123": VENUE_ENTRY,
    });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 90 },
    );
    const titles = result.events.map((e) => e.title);
    expect(titles).toContain("Year Old Event");  // past page: exempt from minDate
    expect(titles).toContain("Near Future");      // upcoming: within window
    expect(titles).toContain("Far Future");       // upcoming: beyond maxDate, now KEPT (#2195)
    expect(titles).not.toContain("Stale Upcoming"); // upcoming: below minDate floor → dropped
    expect(result.events).toHaveLength(3);
  });

  it("maxDate still applies to past events (sanity check)", async () => {
    const farFutureDate = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const farFutureIso = farFutureDate.toISOString().slice(0, 19) + "-05:00";

    const upcomingHtml = buildMeetupHtml({ ROOT_QUERY: { __typename: "Query" } });
    const pastHtml = buildMeetupHtml({
      "Event:weird-1": buildApolloEvent({ id: "weird-1", title: "Future on Past Page", dateTime: farFutureIso }),
    });

    mockDualPageFetch(upcomingHtml, pastHtml);

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 90 },
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0); // Not an error, just filtered
  });

  it("includes dedup and enrichment stats in diagnosticContext", async () => {
    const template = buildRecurringTemplate({ dateTime: ENRICH_DAY });
    const customized = buildCustomizedOccurrence({ dateTime: ENRICH_DAY });

    const upcomingHtml = buildMeetupHtml({
      "Event:fpchvtyjcfbsb": template,
      "Event:313480174": customized,
      "Venue:123": VENUE_ENTRY,
    });
    mockDualPageFetch(upcomingHtml, buildMeetupHtml({}));

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "SavH3" }),
      { days: 365 },
    );
    expect(result.diagnosticContext?.eventsAfterDedup).toBe(1);
    expect(result.diagnosticContext?.detailPagesFetched).toBe(0); // customized has no series field
    expect(result.diagnosticContext?.detailPagesEnriched).toBe(0);
  });
});

describe("isNumericId", () => {
  it("returns true for numeric IDs", () => {
    expect(isNumericId("313480174")).toBe(true);
    expect(isNumericId("12345")).toBe(true);
  });

  it("returns false for alphanumeric token IDs", () => {
    expect(isNumericId("fpchvtyjcfbsb")).toBe(false);
    expect(isNumericId("abc123")).toBe(false);
    expect(isNumericId("")).toBe(false);
  });
});

describe("dedupByDate", () => {
  it("keeps customized occurrence when template and customized share a date", () => {
    const template = { __typename: "Event", id: "fpchvtyjcfbsb", dateTime: "2026-03-14T11:00:00-04:00", series: { __ref: "EventSeries:1" } };
    const customized = { __typename: "Event", id: "313480174", dateTime: "2026-03-14T18:00:00-04:00" };

    const result = dedupByDate([template, customized] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("313480174");
  });

  it("keeps customized even if it comes first", () => {
    const template = { __typename: "Event", id: "fpchvtyjcfbsb", dateTime: "2026-03-14T11:00:00-04:00" };
    const customized = { __typename: "Event", id: "313480174", dateTime: "2026-03-14T18:00:00-04:00" };

    const result = dedupByDate([customized, template] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("313480174");
  });

  it("keeps both customized occurrences when they share a date", () => {
    const morning = { __typename: "Event", id: "111111", dateTime: "2026-03-14T09:00:00-04:00" };
    const evening = { __typename: "Event", id: "222222", dateTime: "2026-03-14T18:00:00-04:00" };

    const result = dedupByDate([morning, evening] as never[]);
    expect(result).toHaveLength(2);
  });

  it("keeps both events when they have different dates", () => {
    const event1 = { __typename: "Event", id: "fpchvtyjcfbsb", dateTime: "2026-03-14T11:00:00-04:00" };
    const event2 = { __typename: "Event", id: "313480174", dateTime: "2026-03-21T11:00:00-04:00" };

    const result = dedupByDate([event1, event2] as never[]);
    expect(result).toHaveLength(2);
  });

  it("preserves events without dateTime", () => {
    const withDate = { __typename: "Event", id: "1", dateTime: "2026-03-14T11:00:00-04:00" };
    const noDate = { __typename: "Event", id: "2" };

    const result = dedupByDate([withDate, noDate] as never[]);
    expect(result).toHaveLength(2);
  });
});

// ── group-template boilerplate detection (#2058/#2059/#2062) ──

describe("normalizeDescriptionKey", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeDescriptionKey("  Hello   World \n FOO ")).toBe("hello world foo");
  });

  it("matches templates that differ only in spacing/case", () => {
    expect(normalizeDescriptionKey("Run/Walk\n\nThen Beer")).toBe(
      normalizeDescriptionKey("run/walk then beer"),
    );
  });
});

describe("detectBoilerplateBlocks", () => {
  it("returns empty set for an empty corpus", () => {
    expect(detectBoilerplateBlocks([]).size).toBe(0);
  });

  it("returns empty set when every description is unique", () => {
    const set = detectBoilerplateBlocks(["alpha notes", "beta notes", "gamma notes"]);
    expect(set.size).toBe(0);
  });

  it("flags a whole single-block description that repeats across >= 2 events", () => {
    const tmpl = "Structure / This event will be a run/walk";
    const set = detectBoilerplateBlocks([tmpl, tmpl, "real per-event notes"]);
    expect(set.has(normalizeDescriptionKey(tmpl))).toBe(true);
    expect(set.has(normalizeDescriptionKey("real per-event notes"))).toBe(false);
  });

  it("flags a shared paragraph block even when the per-event tail differs (#2059)", () => {
    const club = "Hogtown HH3 is a Toronto social running group.";
    const a = `${club}\n\nDate: Fri June 12. Cost: $15.`;
    const b = `${club}\n\nDate: Thu June 25. Cost: $10.`;
    const set = detectBoilerplateBlocks([a, b]);
    expect(set.has(normalizeDescriptionKey(club))).toBe(true);
    // The per-event logistics stanzas differ → not boilerplate.
    expect(set.has(normalizeDescriptionKey("Date: Fri June 12. Cost: $15."))).toBe(false);
  });

  it("ignores undefined and empty/whitespace-only descriptions (cannot be a template)", () => {
    const set = detectBoilerplateBlocks([undefined, "   ", undefined, ""]);
    expect(set.size).toBe(0);
  });

  it("does not self-promote a block a single event repeats internally", () => {
    // One event with the same paragraph twice must NOT count as >= 2 events.
    const set = detectBoilerplateBlocks(["dup para\n\ndup para", "other"]);
    expect(set.size).toBe(0);
  });
});

describe("stripBoilerplateBlocks", () => {
  const club = "Hogtown HH3 is a Toronto social running group.";
  const blocks = new Set([normalizeDescriptionKey(club)]);

  it("returns null when every block is boilerplate", () => {
    expect(stripBoilerplateBlocks(club, blocks)).toBeNull();
  });

  it("strips the boilerplate block and keeps the per-event tail", () => {
    const desc = `${club}\n\nDate: Thu June 25. Cost: $10.`;
    expect(stripBoilerplateBlocks(desc, blocks)).toBe("Date: Thu June 25. Cost: $10.");
  });

  it("returns the original string verbatim when nothing is boilerplate", () => {
    const desc = "Real notes line 1\n\nReal notes line 2";
    expect(stripBoilerplateBlocks(desc, blocks)).toBe(desc);
  });
});

// ── buildRawEventFromApollo — kennelPatterns ──

describe("buildRawEventFromApollo — kennelPatterns", () => {
  const emptyState = {} as Record<string, Record<string, unknown>>;

  it("clears description to null when the whole description is boilerplate (#2058/#2059/#2062)", () => {
    const ev = {
      __typename: "Event",
      id: "bp",
      title: "MH3 Run #1683",
      dateTime: "2026-04-01T18:30:00-04:00",
      description: "<p>Structure / standing club template</p>",
    };
    const boilerplate = new Set([normalizeDescriptionKey("Structure / standing club template")]);
    const event = buildRawEventFromApollo(ev, emptyState, "mh3-ca", undefined, false, undefined, { blocks: boilerplate });
    expect(event.description).toBeNull();
  });

  it("strips the boilerplate block but keeps the per-event tail (#2059 Hogtown)", () => {
    // Real Meetup descriptions are markdown with literal blank-line paragraph
    // breaks (the club blurb and the logistics stanza are separate paragraphs).
    const club = "Hogtown HH3 is a Toronto social running group.";
    const ev = {
      __typename: "Event",
      id: "ht",
      title: "Thursday run",
      dateTime: "2026-04-01T18:30:00-04:00",
      description: `${club}\n\nDate: Thu. Cost: $10.`,
    };
    const boilerplate = new Set([normalizeDescriptionKey(club)]);
    const event = buildRawEventFromApollo(ev, emptyState, "hogtownh3", undefined, false, undefined, { blocks: boilerplate });
    expect(event.description).toBe("Date: Thu. Cost: $10.");
  });

  it("keeps description untouched when no block is boilerplate", () => {
    const ev = {
      __typename: "Event",
      id: "ok",
      title: "MH3 Run #1683",
      dateTime: "2026-04-01T18:30:00-04:00",
      description: "<p>Real per-event notes: meet at the park</p>",
    };
    const boilerplate = new Set([normalizeDescriptionKey("some other template")]);
    const event = buildRawEventFromApollo(ev, emptyState, "mh3-ca", undefined, false, undefined, { blocks: boilerplate });
    expect(event.description).toBe("Real per-event notes: meet at the park");
  });

  it("suppresses endTime when end is on a different calendar day (overnight run)", () => {
    const ev = {
      __typename: "Event",
      id: "ovn",
      title: "Full Moon Hash",
      dateTime: "2026-04-01T22:00:00-04:00",
      endTime: "2026-04-02T02:00:00-04:00",
    };
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3");
    expect(event.startTime).toBe("22:00");
    expect(event.endTime).toBeUndefined();
  });

  it("routes event to matched kennel pattern", () => {
    const ev = {
      __typename: "Event",
      id: "1",
      title: "BIBH3 Trail #246 - TITS HAVE EYES BDAY TRAIL",
      dateTime: "2026-04-01T18:30:00-04:00",
    };
    const patterns: [RegExp, string][] = [[/^BIBH3/i, "bibh3"], [/^TMFMH3/i, "tmfmh3"]];
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3", patterns);
    expect(event.kennelTags[0]).toBe("bibh3");
  });

  it("routes Chain Gang event correctly", () => {
    const ev = {
      __typename: "Event",
      id: "2",
      title: "Chain Gang Hash House Harriers Trail #39",
      dateTime: "2026-04-05T11:00:00-04:00",
    };
    const patterns: [RegExp, string][] = [[/^BIBH3/i, "bibh3"], [/^Chain Gang/i, "chain-gang-hhh"]];
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3", patterns);
    expect(event.kennelTags[0]).toBe("chain-gang-hhh");
  });

  it("routes prefixed Chain Gang AGM title with word-boundary pattern (#992)", () => {
    // Anchored `^Chain Gang` misses "ANNUAL GENERAL MEEING: Chain Gang ..."
    // (the actual Trail #40 title from PR #978 backfill). The seed.ts fix
    // switches to `\bChain Gang\b` — verify it picks up prefixed titles.
    const ev = {
      __typename: "Event",
      id: "agm",
      title: "ANNUAL GENERAL MEEING: Chain Gang Hash House Harriers Trail #40",
      dateTime: "2026-04-25T15:00:00-04:00",
    };
    const patterns: [RegExp, string][] = [
      [/\b(?:BIBH3|Belle Isle)\b/i, "bibh3"],
      [/\b(?:TMFMH3|Titanic)\b/i, "tmfmh3"],
      [/\bChain Gang\b/i, "chain-gang-hhh"],
    ];
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3", patterns);
    expect(event.kennelTags[0]).toBe("chain-gang-hhh");
  });

  it("routes Belle Isle alt-name to bibh3 with word-boundary pattern (#992)", () => {
    const ev = {
      __typename: "Event",
      id: "bibh3-alt",
      title: "20-Year Bash: Belle Isle Brigade Trail #247",
      dateTime: "2026-05-01T18:30:00-04:00",
    };
    const patterns: [RegExp, string][] = [
      [/\b(?:BIBH3|Belle Isle)\b/i, "bibh3"],
      [/\bChain Gang\b/i, "chain-gang-hhh"],
    ];
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3", patterns);
    expect(event.kennelTags[0]).toBe("bibh3");
  });

  it("falls back to default kennelTag when no pattern matches", () => {
    const ev = {
      __typename: "Event",
      id: "3",
      title: "RH3 trail #1687",
      dateTime: "2026-04-06T13:00:00-04:00",
    };
    const patterns: [RegExp, string][] = [[/^BIBH3/i, "bibh3"], [/^TMFMH3/i, "tmfmh3"]];
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3", patterns);
    expect(event.kennelTags[0]).toBe("rvah3");
  });

  it("uses default kennelTag when no patterns provided", () => {
    const ev = {
      __typename: "Event",
      id: "4",
      title: "BIBH3 Trail #247",
      dateTime: "2026-04-08T18:30:00-04:00",
    };
    const event = buildRawEventFromApollo(ev as never, emptyState, "rvah3");
    expect(event.kennelTags[0]).toBe("rvah3");
  });

  it("extracts hares from description (HARE: pattern)", () => {
    const ev = {
      __typename: "Event",
      id: "5",
      title: "Rubber City Trail",
      dateTime: "2026-03-28T15:00:00-04:00",
      description: "<p>HARE: Deez Akronutz, Just Gracia, Chick w/ Heart On</p><p>Trail details...</p>",
    };
    const event = buildRawEventFromApollo(ev as never, emptyState, "rch3");
    expect(event.hares).toBe("Deez Akronutz, Just Gracia, Chick w/ Heart On");
  });

  it("returns undefined hares when description has no hare pattern", () => {
    const ev = {
      __typename: "Event",
      id: "6",
      title: "Regular Trail",
      dateTime: "2026-04-01T18:30:00-04:00",
      description: "<p>Just a regular trail with no hare info</p>",
    };
    const event = buildRawEventFromApollo(ev as never, emptyState, "rch3");
    expect(event.hares).toBeUndefined();
  });

  it("emits null (clear) when the description hare is a bare kennel code — Meetup-local parser must not resurrect it (#2032, Gemini PR #2038 review)", () => {
    // The shared extractor rejects "Hares: DTWH3" as a bare kennel code and
    // returns null (explicit clear). The Meetup-local parser ALSO matches the
    // colon form but lacks the bare-kennel-code filter, so a `??` fall-through
    // would let it resurrect "DTWH3". The clear must win.
    const ev = {
      __typename: "Event",
      id: "8",
      title: "Regular Trail",
      dateTime: "2026-04-05T18:30:00-04:00",
      description: "<p>Hares: DTWH3</p><p>Trail details...</p>",
    };
    const event = buildRawEventFromApollo(ev, emptyState, "rch3");
    expect(event.hares).toBeNull();
  });

  // #1270 — FEH3 admins embed the hare line in the Meetup *title* and leave the
  // description hare-less. The title fallback only fires when neither
  // description path produced hares, so kennels that already work stay untouched.
  describe("hares from title fallback (#1270)", () => {
    it("extracts hares from a title with a hare: label and strips the span (FEH3 Trail 2578)", () => {
      const ev = {
        __typename: "Event",
        id: "7",
        title: "Trail 2578, hare: salty cliterature and this is Sharda white dress!!",
        dateTime: "2026-05-09T16:00:00-04:00",
        // No description hares → title fallback must engage.
        description: "<p>Meet at the usual spot. On-after at the bar.</p>",
      };
      const event = buildRawEventFromApollo(ev, emptyState, "feh3");
      expect(event.hares).toBe("salty cliterature and this is Sharda white dress!!");
      // The "hare:" span is stripped out of the title so names don't appear twice.
      expect(event.title).toBe("Trail 2578");
    });

    it.each([
      // Other kennels' titles carry no hare: label → no change (additive guard).
      ["SAVH3 Trail #1324!"],
      ["BIBH3 Trail #246 - TITS HAVE EYES BDAY TRAIL"],
      // CTA-shaped "Hares Needed" must NOT be mistaken for a hare label.
      ["Trail 300 - Hares Needed - Claim This Trail!"],
      // Themed title with a hyphen after "Hare" must NOT match (colon-only).
      ["Welcome to the Hare-raising Halloween Hash"],
      // Explicit "hare:" whose value is a CTA/placeholder → cleanAndFilterHares drops it.
      ["Annual Red Dress, hare: needed badly"],
    ])("does not invent hares from non-label title %s", (title) => {
      const ev = {
        __typename: "Event",
        id: "8",
        title,
        dateTime: "2026-05-09T16:00:00-04:00",
        description: "<p>Just a regular trail with no hare info</p>",
      };
      const event = buildRawEventFromApollo(ev, emptyState, "feh3");
      expect(event.hares).toBeUndefined();
    });

    it("prefers description hares over the title (fallback not consulted)", () => {
      const ev = {
        __typename: "Event",
        id: "9",
        title: "Trail 99, hare: Title Hare",
        dateTime: "2026-05-09T16:00:00-04:00",
        description: "<p>HARE: Description Hare</p>",
      };
      const event = buildRawEventFromApollo(ev, emptyState, "feh3");
      expect(event.hares).toBe("Description Hare");
    });
  });

  // #1617 — Mel-NM Meetup aggregator hosts events for 5 Melbourne kennels.
  // The seed config wires kennelPatterns to split them. Verify the routing
  // matches what `prisma/seed-data/sources.ts` ships.
  describe("Mel-NM aggregator routing (#1617)", () => {
    const melNmPatterns: [RegExp, string][] = [
      [/^\s*Melbourne\s+New\s+Moon\b/i, "mel-new-moon"],
      [/^\s*(?:Melbourne\s+)?City\s+Hash\b/i, "melbourne-city-h3"],
      [/^\s*Bike\s+hash\b/i, "melbourne-bike-hash"],
      [/^\s*Delinquents\s+HHH\b/i, "delinquents-hhh"],
      [/^\s*Full\s+Moon\s+Run\b/i, "melbourne-full-moon"],
    ];

    it.each([
      ["Melbourne New Moon #175- Klingon @ Exford Hotel", "mel-new-moon"],
      ["Full Moon Run No. 303", "melbourne-full-moon"],
      ["Delinquents HHH No.55 - Trail Theme", "delinquents-hhh"],
      ["City Hash Beer Marathon", "melbourne-city-h3"],
      ["Melbourne City Hash Thursday Run", "melbourne-city-h3"],
      ["Bike hash ride #17", "melbourne-bike-hash"],
    ])("routes %q → %q", (title, expectedTag) => {
      const ev = {
        __typename: "Event",
        id: `mel-${expectedTag}`,
        title,
        dateTime: "2026-04-01T18:30:00+10:00",
      };
      const event = buildRawEventFromApollo(
        ev,
        emptyState,
        "mel-new-moon",
        melNmPatterns,
      );
      expect(event.kennelTags[0]).toBe(expectedTag);
    });

    it("falls back to mel-new-moon for unrouted titles", () => {
      const ev = {
        __typename: "Event",
        id: "unrouted",
        title: "Run No. 42",
        dateTime: "2026-04-01T18:30:00+10:00",
      };
      const event = buildRawEventFromApollo(
        ev,
        emptyState,
        "mel-new-moon",
        melNmPatterns,
      );
      expect(event.kennelTags[0]).toBe("mel-new-moon");
    });
  });
});

// ── cleanMeetupTitle — trailing CTA strip (#1645 RH3 / #1646 TMFMH3) ──

describe("cleanMeetupTitle", () => {
  it.each([
    // #1645 RH3 — "CLAIM THIS TRAIL" trailing placeholder
    ["RH3 # 1698 CLAIM THIS TRAIL", "RH3 # 1698"],
    ["RH3 # 1701 CLAIM THIS TRAIL", "RH3 # 1701"],
    ["RH3 # 1703 CLAIM THIS TRAIL", "RH3 # 1703"],
    // #1646 TMFMH3 — case + punctuation variant
    ["TMFMH3 Trail 300: Claim this Trail!", "TMFMH3 Trail 300"],
    // Other CTA forms covered by CTA_EMBEDDED_PATTERNS
    ["Saturday Trail - Hares Needed", "Saturday Trail"],
    ["Friday Run - Looking for a hare", "Friday Run"],
    // Stacked trailing CTAs — iteration over CTA_EMBEDDED_PATTERNS strips
    // each pass; trailing-connector cleanup runs once at the end.
    ["Trail 300 - Hares Needed - Claim This Trail!", "Trail 300"],
  ])("strips trailing CTA: %q → %q", (raw, expected) => {
    expect(cleanMeetupTitle(raw)).toBe(expected);
  });

  it.each([
    // Themed titles where CTA-shaped text appears mid-title legitimately must NOT be stripped
    ["Hares Needed Hash Theme: Costume Night", "Hares Needed Hash Theme: Costume Night"],
    ["Claim This Trail Anniversary Edition", "Claim This Trail Anniversary Edition"],
    ["Saturday Trail", "Saturday Trail"],
    ["MH3 Trail #1048 MAY DAY EVE IN VIZCAYA", "MH3 Trail #1048 MAY DAY EVE IN VIZCAYA"],
  ])("preserves legitimate titles: %q", (raw, expected) => {
    expect(cleanMeetupTitle(raw)).toBe(expected);
  });

  it("returns undefined for null/undefined/empty inputs", () => {
    expect(cleanMeetupTitle(null)).toBeUndefined();
    expect(cleanMeetupTitle(undefined)).toBeUndefined();
    expect(cleanMeetupTitle("")).toBeUndefined();
  });

  it("returns undefined when title collapses to empty after strip", () => {
    expect(cleanMeetupTitle("Hares Needed")).toBeUndefined();
    expect(cleanMeetupTitle("CLAIM THIS TRAIL")).toBeUndefined();
  });

  // #1618 — Mel-NM Meetup leaked the group recurrence blurb as event title
  // on 13 events. Drop the template shape so merge.ts synthesizes a
  // "<KennelName> Trail #N" replacement.
  it.each([
    "Every Wednesday @ 6:30pm from tbd",
    "Every Wed @ 6:30",
    "Every Sat @ 10am from TBA",
    "Saturday Trail from TBD",
    "Weekly Friday Run from TBC",
  ])("drops template-shaped title: %q", (raw) => {
    expect(cleanMeetupTitle(raw)).toBeUndefined();
  });

  it.each([
    // Real titles with "every" that shouldn't false-positive.
    "Every Saturday Trail",
    "Every Wednesday Hash Run",
    // Real titles that mention "from" without the TBA placeholder.
    "Saturday Trail from Memorial Park",
    "Friday Run from Brewery",
  ])("preserves legitimate title that shares words with template patterns: %q", (raw) => {
    expect(cleanMeetupTitle(raw)).toBe(raw);
  });
});

// ── buildRawEventFromApollo — runNumber extraction (#1562) ──

describe("buildRawEventFromApollo — runNumber (#1562 Miami H3)", () => {
  const emptyState = {} as Record<string, Record<string, unknown>>;
  // 5th positional arg is `extractRunNumber` — opt-in per source. Miami
  // sets `extractRunNumber: true` in its source config (#1562); other
  // Meetup sources stay at the safe default of `undefined`/`false`.
  const OPT_IN = true;

  it.each([
    ["Miami H3 Trail #1048 MAY DAY EVE IN VIZCAYA", 1048],
    ["MIAMI H3 #1047 North Miami Beach Picnic Trail", 1047],
    ["TRAIL #1031 KING MANGO STRUT PARADE", 1031],
    ["Miami H3 Trail #703", 703],
    ["Miami Hash #969 MisMan & Sons Honor Trail", 969],
  ])("extracts runNumber from %j when opted in", (title, expected) => {
    const ev = { __typename: "Event", id: "rn", title, dateTime: "2026-04-01T18:30:00-04:00" };
    const event = buildRawEventFromApollo(ev, emptyState, "mia-h3", undefined, OPT_IN);
    expect(event.runNumber).toBe(expected);
  });

  it("leaves runNumber undefined when title uses '@' typo instead of '#'", () => {
    const ev = {
      __typename: "Event",
      id: "typo",
      title: "MIAMI H3 @1041 CALLE OCHO",
      dateTime: "2026-04-01T18:30:00-04:00",
    };
    const event = buildRawEventFromApollo(ev, emptyState, "mia-h3", undefined, OPT_IN);
    expect(event.runNumber).toBeUndefined();
  });

  it("leaves runNumber undefined when title has no run number token", () => {
    const ev = {
      __typename: "Event",
      id: "no-rn",
      title: "Miami Hash House Harriers",
      dateTime: "2026-04-01T18:30:00-04:00",
    };
    const event = buildRawEventFromApollo(ev, emptyState, "mia-h3", undefined, OPT_IN);
    expect(event.runNumber).toBeUndefined();
  });

  it("leaves runNumber undefined when source did NOT opt in (default behavior)", () => {
    // Codex review on the #1562 PR — protect non-Miami Meetup sources from
    // false-positive run-number tokens like "Pub Crawl #2" / "Stop #1" by
    // defaulting extraction off. Only sources whose admins opt in via
    // `extractRunNumber: true` get the promotion.
    const ev = {
      __typename: "Event",
      id: "no-opt",
      title: "Miami H3 Trail #1048 MAY DAY EVE",
      dateTime: "2026-04-01T18:30:00-04:00",
    };
    const event = buildRawEventFromApollo(ev, emptyState, "mia-h3");
    expect(event.runNumber).toBeUndefined();
  });
});

// ── buildRawEventFromApollo — runNumber (Richmond H3 + sisters) ──

describe("buildRawEventFromApollo — runNumber (Richmond H3 rvah3, anchored)", () => {
  const emptyState = {} as Record<string, Record<string, unknown>>;
  const OPT_IN = true;
  // Richmond opts into the trail-context anchor (a leading kennel-code token
  // before "#", or "Trail #"); non-trail "#N" tokens are excluded.
  const richmondCfg = (SOURCES.find((s) => s.name === "Richmond H3 Meetup")?.config ?? {}) as {
    anchorTrailRunNumber?: boolean;
    extractRunNumber?: boolean;
  };
  const build = (title: string, tag: string) =>
    buildRawEventFromApollo(
      { __typename: "Event", id: title, title, dateTime: "2026-06-28T13:00:00-04:00" },
      emptyState, tag, undefined, OPT_IN, undefined, { anchorTrail: true },
    );

  it.each([
    ["RH3 # 1704 - Medley of Mud #3 I-Feel Tower, Biff!", 1704],
    ["RH3 # 1700 NASA", 1700],
    ["RH3 # 1703", 1703],
    ["RH3 Trail #1696: Rock N Roll Don't Die Doh", 1696],
    ["RH3 Trail # 1694: Gladiater", 1694],
    // Anchor captures the "RH3 #" run number, not the trailing theme "#3"/"#2".
    ["RH3 # 1702 - MEDLEY OF MUD #2 BananTa", 1702],
  ])("extracts the RH3 trail run number from %j", (title, expected) => {
    expect(build(title, "rvah3").runNumber).toBe(expected);
  });

  it("extracts sister-kennel run numbers (BIBH3 / Chain Gang)", () => {
    expect(build("BIBH3 Trail #251 - DRAG RACE!!", "bibh3").runNumber).toBe(251);
    expect(build("Chain Gang Trail #42", "chain-gang-hhh").runNumber).toBe(42);
  });

  it.each([
    "RH3 #1704TBD",   // placeholder suffix glued to digits
    "RH3 Trail #30X?", // explicit unknown-run marker
  ])("rejects placeholder/ambiguous run tokens via the shared delimiter guard: %j", (title) => {
    // The anchor only locates the "#"; extractHashRunNumber parses the slice, so
    // its delimiter guard still drops these (Codex PR #2207 review).
    expect(build(title, "rvah3").runNumber).toBeUndefined();
  });

  it("does NOT mint a run number for the non-trail 'Drinking Practice #15' social", () => {
    // The whole reason for the anchor: runNumber feeds same-day merge identity,
    // so a non-trail "#15" must not become a canonical run number. Without the
    // anchor the generic parser would grab 15 (asserted below).
    expect(build("Inter-Kennel Drinking Practice #15 hosted by RH3!", "rvah3").runNumber).toBeUndefined();
  });

  it("the unanchored generic parser WOULD grab the bogus 15 — confirming the anchor is load-bearing", () => {
    const ev = { __typename: "Event", id: "dp", title: "Inter-Kennel Drinking Practice #15 hosted by RH3!", dateTime: "2026-06-15T18:30:00-04:00" };
    expect(buildRawEventFromApollo(ev, emptyState, "rvah3", undefined, OPT_IN).runNumber).toBe(15);
  });

  it("the Richmond H3 Meetup seed source opts in with the trail anchor", () => {
    expect(richmondCfg.extractRunNumber).toBe(true);
    expect(richmondCfg.anchorTrailRunNumber).toBe(true);
  });
});

// ── buildRawEventFromApollo — runNumberPrefix (#1975 Paris / Sans Clue) ──

describe("buildRawEventFromApollo — runNumberPrefix (#1975 Paris/Sans Clue 'R*n')", () => {
  const emptyState = {} as Record<string, Record<string, unknown>>;
  // 6th positional arg is `runNumberPrefix` — the literal token a kennel uses
  // instead of "#". Paris H3 + Sans Clue H3 self-censor "Run" as "R*n".
  const OPT_IN = true;
  const PREFIX = "R*n";

  it.each([
    ["Paris H3 R*n 1136 | TBD", 1136],
    ["Sans Clue H3 R*n 1192 | TBD", 1192],
    ["Paris H3 R*n 1134 | ✨ Eurovision! ✨", 1134],
    ["Sans Clue H3 R*n 1196", 1196],
  ])("extracts runNumber from %j by normalizing the R*n prefix", (title, expected) => {
    const ev = { __typename: "Event", id: "rxn", title, dateTime: "2026-06-06T14:00:00+02:00" };
    const event = buildRawEventFromApollo(ev, emptyState, "paris-h3", undefined, OPT_IN, PREFIX);
    expect(event.runNumber).toBe(expected);
  });

  it("keeps the kennel's 'R*n' stylization in the display title", () => {
    const ev = { __typename: "Event", id: "disp", title: "Paris H3 R*n 1136 | TBD", dateTime: "2026-06-06T14:00:00+02:00" };
    const event = buildRawEventFromApollo(ev, emptyState, "paris-h3", undefined, OPT_IN, PREFIX);
    expect(event.title).toBe("Paris H3 R*n 1136 | TBD");
  });

  it("leaves runNumber undefined when the prefix is configured but extraction is off", () => {
    const ev = { __typename: "Event", id: "off", title: "Paris H3 R*n 1136 | TBD", dateTime: "2026-06-06T14:00:00+02:00" };
    const event = buildRawEventFromApollo(ev, emptyState, "paris-h3", undefined, false, PREFIX);
    expect(event.runNumber).toBeUndefined();
  });

  it("leaves runNumber undefined for an 'R*n' title when no prefix is configured (no regression)", () => {
    // Without runNumberPrefix the shared helper only matches '#NNN', so the
    // bare "R*n 1136" form yields nothing — exactly what other Meetup kennels see.
    const ev = { __typename: "Event", id: "norm", title: "Paris H3 R*n 1136 | TBD", dateTime: "2026-06-06T14:00:00+02:00" };
    const event = buildRawEventFromApollo(ev, emptyState, "paris-h3", undefined, OPT_IN);
    expect(event.runNumber).toBeUndefined();
  });
});

// ── runNumber from description (#2167 Savannah H3) ──

describe("extractRunNumberFromMeetupDescription (#2167 Savannah)", () => {
  it.each([
    ["Savannah H3 trail # 1338", 1338],
    ["Savannah H3 Trail #: 1334", 1334],
    ["What: Trail #1335", 1335],
    ["Savannah H3 Trail #1333", 1333],
  ])("extracts the run number from a 'Trail #N' description line: %j", (desc, expected) => {
    expect(extractRunNumberFromMeetupDescription(desc)).toBe(expected);
  });

  it("tolerates Markdown bold around the trail line (Charlotte '**Trail # 1244**')", () => {
    expect(extractRunNumberFromMeetupDescription("**Trail # 1244 - There's a Latta Animals Trail**")).toBe(1244);
  });

  it("finds the trail line inside a multi-line boilerplate description", () => {
    const desc = "Savannah H3 trail # 1338\n\n**Structure**\n\nThis event will be a run/walk...";
    expect(extractRunNumberFromMeetupDescription(desc)).toBe(1338);
  });

  it("returns undefined when no line pairs 'trail' with a number (boilerplate-only)", () => {
    // Montreal's standing template mentions "trail" many times but carries no
    // per-run number — must NOT promote a bogus value.
    const desc = "Note that if a trail has been set, the hash WILL run it!\n\nOur runs usually have a split trail for walkers.";
    expect(extractRunNumberFromMeetupDescription(desc)).toBeUndefined();
  });

  it("returns undefined for a stray '#3' not sharing a line with 'trail'", () => {
    expect(extractRunNumberFromMeetupDescription("Meet at gate #3.\nBring water.")).toBeUndefined();
  });

  it.each([
    // "trail" must be directly anchored to "#N" — substring/adjacency prose
    // must NOT promote a number (Codex adversarial review).
    "Meet at Trailhead gate #3",
    "choose trail option #2",
    "follow the trail, then find marker #5",
  ])("returns undefined for non-run trail prose: %j", (desc) => {
    expect(extractRunNumberFromMeetupDescription(desc)).toBeUndefined();
  });

  it("returns undefined for empty/undefined input", () => {
    expect(extractRunNumberFromMeetupDescription(undefined)).toBeUndefined();
    expect(extractRunNumberFromMeetupDescription("")).toBeUndefined();
  });
});

describe("buildRawEventFromApollo — runNumber from description (#2167 Savannah)", () => {
  const emptyState = {} as Record<string, Record<string, unknown>>;

  it("extracts the run number from the description even with a generic title and extraction off", () => {
    // Savannah's titles are the generic "Saturday Trail!"; the real number
    // lives in the body. Default-on description extraction (trail-anchored)
    // backfills it without the per-source opt-in title flag.
    const ev = {
      __typename: "Event",
      id: "savh3",
      title: "Saturday Trail!",
      description: "Savannah H3 trail # 1338\n\nMeet at the park.",
      dateTime: "2026-06-20T14:00:00-04:00",
    };
    const event = buildRawEventFromApollo(ev, emptyState, "savh3");
    expect(event.runNumber).toBe(1338);
  });

  it("leaves runNumber undefined when the description has no trail-anchored number", () => {
    const ev = {
      __typename: "Event",
      id: "tt",
      title: "Thirsty Thursday / Drinking Practice",
      description: "Join us for drinks! No run tonight.",
      dateTime: "2026-06-18T18:30:00-04:00",
    };
    const event = buildRawEventFromApollo(ev, emptyState, "savh3");
    expect(event.runNumber).toBeUndefined();
  });
});

describe("extractHaresFromMeetupDescription (#953 CHH3 dash separator)", () => {
  it("captures 'Hares - X and Y' (plural, dash, ASCII hyphen)", () => {
    expect(extractHaresFromMeetupDescription("Hares - FAW and Just Jim\n\nGo see the rail yards"))
      .toBe("FAW and Just Jim");
  });

  it("captures 'Hare - X' (singular)", () => {
    expect(extractHaresFromMeetupDescription("Hare - She Shooters She Scores (Again) with Just Dave"))
      .toBe("She Shooters She Scores (Again) with Just Dave");
  });

  it("is case-insensitive", () => {
    expect(extractHaresFromMeetupDescription("hares - alice")).toBe("alice");
    expect(extractHaresFromMeetupDescription("HARE - bob")).toBe("bob");
  });

  it("handles en-dash and em-dash", () => {
    expect(extractHaresFromMeetupDescription("Hares – Alice")).toBe("Alice");
    expect(extractHaresFromMeetupDescription("Hare — Bob")).toBe("Bob");
  });

  it("pass-1 caps at the first 5 lines but pass-2 backstops anywhere (#975)", () => {
    // Filler lines push the Hares line past pass-1's 5-line cap, but the
    // sentence-level pass-2 regex still finds it. The cap exists so a footer
    // that mentions "hare" prose can't override a real label, but actual
    // labels deep in a description should still resolve.
    const desc = [
      "Filler 1", "Filler 2", "Filler 3", "Filler 4", "Filler 5", "Filler 6",
      "Hares - Late Liner",
    ].join("\n");
    expect(extractHaresFromMeetupDescription(desc)).toBe("Late Liner");
  });

  it("truncates trailing boilerplate field labels (HASH CASH)", () => {
    // When HTML stripping collapses several fields onto one line,
    // HARE_BOILERPLATE_RE caps the hare names at the first known label.
    expect(extractHaresFromMeetupDescription("Hares - FAW and Just Jim HASH CASH: $5"))
      .toBe("FAW and Just Jim");
  });

  it("returns undefined when no Hare(s) line is present", () => {
    expect(extractHaresFromMeetupDescription("2pm Show 2:30pm Go\n$5 Hash Cash"))
      .toBeUndefined();
  });

  it("returns undefined for an empty/missing description", () => {
    expect(extractHaresFromMeetupDescription(undefined)).toBeUndefined();
    expect(extractHaresFromMeetupDescription("")).toBeUndefined();
  });

  // #975: also accept the colon form. The upstream `extractHaresFromDescription`
  // (google-calendar helper) catches `Hares:` only when the line starts at a
  // newline boundary; some Meetup descriptions concatenate it after prose, so
  // the local helper backstops both shapes line-by-line.
  it("captures 'Hares: X and Y' colon form (#975)", () => {
    expect(extractHaresFromMeetupDescription("Hares: Birthday Gurrrl and Tub Puppet"))
      .toBe("Birthday Gurrrl and Tub Puppet");
  });

  it("captures 'Hare: X' singular colon form (#975)", () => {
    expect(extractHaresFromMeetupDescription("Hare: Yellow Snow Cone"))
      .toBe("Yellow Snow Cone");
  });

  it("captures mid-paragraph 'Hares: X and Y' run-on prose (#975 Cleveland H4)", () => {
    const desc = "Kentucky Derby Hash. Bring a fancy hat and enjoy Cleveland's first trail of 2026. CH4 is not dead! Hares: Birthday Gurrrl and Tub Puppet. Location: Winking Lizard.";
    expect(extractHaresFromMeetupDescription(desc))
      .toBe("Birthday Gurrrl and Tub Puppet");
  });
});

describe("buildRawEventFromApollo — CHH3 dash-form fallback (#953)", () => {
  const emptyState = {};

  it("falls back to dash-form regex when colon-form returns undefined", () => {
    const ev = {
      __typename: "Event",
      id: "999",
      title: "Heretics Trail - The Kennel Gets Railed",
      dateTime: "2026-04-25T14:00:00-04:00",
      description: "Hares - FAW and Just Jim\n\nGo see the magnificent rail yards.",
    };
    const event = buildRawEventFromApollo(ev as never, emptyState, "chh3");
    expect(event.hares).toBe("FAW and Just Jim");
  });

  it("prefers colon-form match when present (no fallback fired)", () => {
    const ev = {
      __typename: "Event",
      id: "1000",
      title: "Heretics Trail - Love Sucks",
      dateTime: "2026-02-14T14:00:00-04:00",
      description: "Hares: Just Josh\n2pm Show 2:30pm Go",
    };
    const event = buildRawEventFromApollo(ev as never, emptyState, "chh3");
    expect(event.hares).toBe("Just Josh");
  });
});
