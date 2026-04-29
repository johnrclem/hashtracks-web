import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetupAdapter, extractApolloEvents, resolveVenue, isNumericId, dedupByDate, stripTrailingState, deduplicateWords, isStateFullName, buildRawEventFromApollo, extractHaresFromMeetupDescription } from "./adapter";
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

/** Build a minimal Apollo event object. */
function buildApolloEvent(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "Event",
    id: "313348941",
    title: "Trail #42 — Central Park",
    dateTime: "2026-03-15T18:00:00-05:00",
    endTime: "2026-03-15T21:00:00-05:00",
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
        dateTime: "2026-01-10T14:00:00-05:00",
        status: "CANCELLED",
      }),
      "Event:active": buildApolloEvent({
        id: "1235-active",
        title: "Charlotte H3 Trail #1235 - An East Charlotte Snow Melt Trail!",
        dateTime: "2026-02-07T14:00:00-05:00",
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
    expect(result.events[0].date).toBe("2026-03-15");
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

  it("filters events outside the lookback window", async () => {
    const futureDate = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const futureIso = futureDate.toISOString().slice(0, 19) + "-05:00";

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
    // far-future event is >90 days out and should be excluded
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Trail #42 — Central Park");
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
    const futureEvent = buildApolloEvent({ id: "future-1", title: "Upcoming Run", dateTime: "2026-03-20T18:00:00-05:00" });
    const pastEvent = buildApolloEvent({ id: "past-1", title: "Past Run", dateTime: "2026-02-15T18:00:00-05:00" });

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
    const futureEvent = buildApolloEvent({ id: "future-1", dateTime: "2026-03-20T18:00:00-05:00" });
    const pastEvent = buildApolloEvent({ id: "past-1", dateTime: "2026-02-15T18:00:00-05:00" });

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
    const template = buildRecurringTemplate({ dateTime: "2026-03-14T11:00:00-04:00" });
    const customized = buildCustomizedOccurrence({ dateTime: "2026-03-14T11:00:00-04:00" });

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
    const template = buildRecurringTemplate({ dateTime: "2026-03-14T11:00:00-04:00" });
    const detailEvent = buildApolloEvent({
      id: "fpchvtyjcfbsb",
      title: "SAVH3 Trail #1324 — Forsyth Park!",
      description: "<p>Detailed hare info and shiggy level</p>",
      dateTime: "2026-03-14T11:00:00-04:00",
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
    const template = buildRecurringTemplate({ dateTime: "2026-03-14T11:00:00-04:00" });
    // Detail page contains a different event ID — should NOT be used for enrichment
    const unrelatedEvent = buildApolloEvent({
      id: "unrelated-999",
      title: "Wrong Event Title",
      description: "<p>Wrong event data</p>",
      dateTime: "2026-03-14T11:00:00-04:00",
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
    const template = buildRecurringTemplate({ dateTime: "2026-03-14T11:00:00-04:00" });

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
    const normalEvent = buildApolloEvent({ dateTime: "2026-03-14T11:00:00-04:00" });

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

  it("past events exempt from minDate but upcoming still filtered by full window", async () => {
    const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const veryOldIso = veryOldDate.toISOString().slice(0, 19) + "-05:00";
    const farFutureDate = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const farFutureIso = farFutureDate.toISOString().slice(0, 19) + "-05:00";
    const nearFutureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const nearFutureIso = nearFutureDate.toISOString().slice(0, 19) + "-05:00";

    const pastEvent = buildApolloEvent({ id: "past-365", title: "Year Old Event", dateTime: veryOldIso });
    const farFutureEvent = buildApolloEvent({ id: "far-future", title: "Far Future", dateTime: farFutureIso, eventUrl: "https://www.meetup.com/test-hash/events/far-future/" });
    const nearFutureEvent = buildApolloEvent({ id: "near-future", title: "Near Future", dateTime: nearFutureIso, eventUrl: "https://www.meetup.com/test-hash/events/near-future/" });

    const upcomingHtml = buildMeetupHtml({
      "Event:far-future": farFutureEvent,
      "Event:near-future": nearFutureEvent,
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
    expect(titles).toContain("Year Old Event");  // past: exempt from minDate
    expect(titles).toContain("Near Future");      // upcoming: within 90-day window
    expect(titles).not.toContain("Far Future");   // upcoming: beyond maxDate
    expect(result.events).toHaveLength(2);
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
    const template = buildRecurringTemplate({ dateTime: "2026-03-14T11:00:00-04:00" });
    const customized = buildCustomizedOccurrence({ dateTime: "2026-03-14T11:00:00-04:00" });

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

// ── buildRawEventFromApollo — kennelPatterns ──

describe("buildRawEventFromApollo — kennelPatterns", () => {
  const emptyState = {} as Record<string, Record<string, unknown>>;

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
