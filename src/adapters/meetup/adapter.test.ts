import { describe, it, expect, vi, beforeEach } from "vitest";
import { MeetupAdapter } from "./adapter";
import type { Source } from "@/generated/prisma/client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeSource(config: unknown): Source {
  return {
    id: "src-1",
    config,
    url: "https://meetup.com/test-hash",
    type: "MEETUP",
  } as unknown as Source;
}

const UPCOMING_EVENT = {
  id: "evt-1",
  name: "Trail #42 — Central Park",
  status: "upcoming",
  time: new Date("2026-03-15T18:00:00Z").getTime(),
  local_date: "2026-03-15",
  local_time: "18:00",
  duration: 7200000,
  description: "<p>Join us for a fun trail!</p>",
  venue: { name: "Central Park Tavern", address_1: "100 W 67th St", city: "New York", state: "NY" },
  link: "https://meetup.com/test-hash/events/evt-1",
};

const PAST_EVENT = {
  id: "evt-0",
  name: "Trail #41",
  status: "past",
  time: new Date("2026-02-01T14:00:00Z").getTime(),
  local_date: "2026-02-01",
  local_time: "14:00",
  venue: { name: "Some Bar", city: "Brooklyn" },
  link: "https://meetup.com/test-hash/events/evt-0",
};

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

  it("returns error on non-ok API response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/404/);
  });

  it("parses events and assigns kennelTag", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [UPCOMING_EVENT, PAST_EVENT],
    });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBe(2);
    expect(result.events[0].kennelTag).toBe("NYCH3");
    expect(result.events[0].title).toBe("Trail #42 — Central Park");
    expect(result.events[0].date).toBe("2026-03-15");
    expect(result.events[0].startTime).toBe("18:00");
  });

  it("builds location from venue fields", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [UPCOMING_EVENT],
    });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].location).toBe("Central Park Tavern, 100 W 67th St, New York, NY");
  });

  it("strips HTML tags from description", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [UPCOMING_EVENT],
    });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].description).toBe("Join us for a fun trail!");
  });

  it("filters events outside the lookback window", async () => {
    const futureTime = Date.now() + 200 * 24 * 60 * 60 * 1000;
    const futureDate = new Date(futureTime);
    const futureEvent = {
      ...UPCOMING_EVENT,
      id: "evt-future",
      time: futureTime,
      local_date: futureDate.toISOString().slice(0, 10),
      local_time: "18:00",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [UPCOMING_EVENT, futureEvent],
    });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 90 },
    );
    // futureEvent is >90 days out and should be excluded; UPCOMING_EVENT is within window
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Trail #42 — Central Park");
  });

  it("includes sourceUrl from event link", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [UPCOMING_EVENT],
    });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.events[0].sourceUrl).toBe(UPCOMING_EVENT.link);
  });

  it("populates diagnosticContext", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [UPCOMING_EVENT],
    });
    const adapter = new MeetupAdapter();
    const result = await adapter.fetch(
      makeSource({ groupUrlname: "test-hash", kennelTag: "NYCH3" }),
      { days: 365 },
    );
    expect(result.diagnosticContext?.groupUrlname).toBe("test-hash");
  });
});
