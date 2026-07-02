import { TribeEventsAdapter, isTribeEventsConfig } from "./tribe-events-adapter";
import type { Source } from "@/generated/prisma/client";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Date N days from now, "YYYY-MM-DD" — keeps windowed assertions from aging out. */
function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** start_date_details from a YYYY-MM-DD + HH:MM. */
function details(date: string, hour: string, minutes: string) {
  return { year: date.slice(0, 4), month: date.slice(5, 7), day: date.slice(8, 10), hour, minutes };
}

function mkSource(config: unknown): Source {
  return {
    id: "s1", name: "Larrikins Specials", url: "https://sydney.larrikins.org",
    type: "HTML_SCRAPER", config,
  } as unknown as Source;
}

beforeEach(() => mockedSafeFetch.mockReset());

describe("isTribeEventsConfig", () => {
  it("accepts { tribeEvents: true, kennelTag }", () => {
    expect(isTribeEventsConfig({ tribeEvents: true, kennelTag: "larrikins-au" })).toBe(true);
  });
  it("rejects a missing discriminator, empty/absent kennelTag, and non-objects", () => {
    expect(isTribeEventsConfig({ kennelTag: "x" })).toBe(false);
    expect(isTribeEventsConfig({ tribeEvents: true })).toBe(false);
    expect(isTribeEventsConfig({ tribeEvents: true, kennelTag: "" })).toBe(false);
    expect(isTribeEventsConfig(null)).toBe(false);
    expect(isTribeEventsConfig("nope")).toBe(false);
  });
});

describe("TribeEventsAdapter.fetch", () => {
  it("errors on a non-Tribe config without hitting the network", async () => {
    const res = await new TribeEventsAdapter().fetch(mkSource({ foo: 1 }));
    expect(res.events).toEqual([]);
    expect(res.errors[0]).toMatch(/tribeEvents/);
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("fails closed on a forward-only config missing upcomingOnly (no network call)", async () => {
    // No startDate → forward-only; without upcomingOnly, reconcile would cancel
    // past sole-source events. Must refuse rather than silently succeed.
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au" }), { days: 400 },
    );
    expect(res.events).toEqual([]);
    expect(res.errors[0]).toMatch(/upcomingOnly/);
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("allows a config with an explicit startDate even without upcomingOnly (backfill exemption)", async () => {
    const d = isoDate(-30);
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      events: [{ id: 9, title: "Past Special", start_date: `${d} 12:00:00` }],
      total: 1, total_pages: 1,
    }));
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", startDate: "2026-01-01" }), { days: 9999 },
    );
    expect(mockedSafeFetch).toHaveBeenCalled();
    expect(res.errors).toEqual([]);
    expect(res.events).toHaveLength(1);
  });

  it("pushes a truncation error when the maxEvents cap is hit (blocks reconcile)", async () => {
    const d = isoDate(4);
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      events: [
        { id: 10, title: "One", start_date: `${d} 10:00:00` },
        { id: 11, title: "Two", start_date: `${d} 11:00:00` },
      ],
      total: 2, total_pages: 1,
    }));
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true, maxEvents: 1 }), { days: 400 },
    );
    expect(res.events).toHaveLength(1);
    expect(res.errors.some((e) => /truncated at maxEvents=1/.test(e))).toBe(true);
  });

  it("maps events to RawEventData (kennelTag, date, time, decoded title, cleaned location)", async () => {
    const d = isoDate(10);
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      events: [{
        id: 1, title: "Larrikin Long Lunch",
        url: "https://sydney.larrikins.org/event/lll/",
        start_date: `${d} 13:30:00`, start_date_details: details(d, "13", "30"),
        venue: { venue: "Sydney Fish Markets", address: "1 Bridge Rd,", city: "Glebe" },
        all_day: false,
      }],
      total: 1, total_pages: 1,
    }));
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true }), { days: 400 },
    );
    expect(res.errors).toEqual([]);
    expect(res.events).toHaveLength(1);
    expect(res.events[0]).toMatchObject({
      date: d, startTime: "13:30", kennelTags: ["larrikins-au"],
      title: "Larrikin Long Lunch", location: "1 Bridge Rd, Glebe",
      sourceUrl: "https://sydney.larrikins.org/event/lll/",
    });
  });

  it("filters out events beyond the date window", async () => {
    const far = isoDate(9000);
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      events: [{ id: 2, title: "Way Future", start_date: `${far} 10:00:00` }],
      total: 1, total_pages: 1,
    }));
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true }), { days: 30 },
    );
    expect(res.events).toEqual([]);
  });

  it("drops the meaningless all-day 00:00 time, or uses defaultStartTime when set", async () => {
    const d = isoDate(5);
    const body = {
      events: [{ id: 3, title: "Campout", start_date_details: details(d, "00", "00"), all_day: true }],
      total: 1, total_pages: 1,
    };
    mockedSafeFetch.mockResolvedValue(jsonResponse(body));
    const noDefault = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true }), { days: 400 },
    );
    expect(noDefault.events[0].startTime).toBeUndefined();

    mockedSafeFetch.mockResolvedValue(jsonResponse(body));
    const withDefault = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true, defaultStartTime: "18:30" }), { days: 400 },
    );
    expect(withDefault.events[0].startTime).toBe("18:30");
  });

  it("surfaces skippedCount as a soft error (schema-drift signal)", async () => {
    const d = isoDate(3);
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      events: [
        { id: 4, title: "Good", start_date: `${d} 12:00:00` },
        { id: 5, start_date: `${d} 12:00:00` }, // no title → skipped by normalizeTribeEvent
      ],
      total: 2, total_pages: 1,
    }));
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true }), { days: 400 },
    );
    expect(res.events).toHaveLength(1);
    expect(res.errors.some((e) => /Skipped 1\/2/.test(e))).toBe(true);
  });

  it("propagates a fetch HTTP error into errorDetails", async () => {
    mockedSafeFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const res = await new TribeEventsAdapter().fetch(
      mkSource({ tribeEvents: true, kennelTag: "larrikins-au", upcomingOnly: true }),
    );
    expect(res.events).toEqual([]);
    expect(res.errorDetails?.fetch?.[0].status).toBe(500);
  });
});
