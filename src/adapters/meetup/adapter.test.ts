import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetupAdapter, extractApolloEvents, resolveVenue } from "./adapter";
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
    expect(result.location).toBe("Miami Miami, FL, Florida");
  });

  it("skips state when already present in name", () => {
    const state = {};
    const result = resolveVenue(state, { name: "Downtown Bar, NY", address: "123 Main St", city: "New York", state: "NY" });
    expect(result.location).toBe("Downtown Bar, NY, 123 Main St, New York");
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
});
