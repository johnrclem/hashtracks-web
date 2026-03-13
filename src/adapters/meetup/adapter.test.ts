import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetupAdapter, extractApolloEvents, resolveVenue, isNumericId, dedupByDate, stripTrailingState, deduplicateWords, isStateFullName } from "./adapter";
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
    expect(result.events[0].kennelTag).toBe("NYCH3");
    expect(result.events[0].title).toBe("Trail #42 — Central Park");
    expect(result.events[0].date).toBe("2026-03-15");
    expect(result.events[0].startTime).toBe("18:00");
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
    mockHtmlResponse("<html><body>No events here</body></html>");

    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/NEXT_DATA/);
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

  it("filters combined events by date window", async () => {
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
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Recent Event");
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
