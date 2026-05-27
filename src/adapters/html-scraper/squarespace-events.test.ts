import type { Source } from "@/generated/prisma/client";
import {
  parseSquarespaceEvent,
  SquarespaceEventsAdapter,
  type SquarespaceEventsConfig,
} from "./squarespace-events";
import { buildSource } from "@/test/factories";

const PT = "America/Los_Angeles";
const BASE = "https://sach3.beer";
const CONFIG: SquarespaceEventsConfig = { kennelTag: "sach3" };

// 2026-05-27 18:30 PDT = 2026-05-28T01:30:00Z
const WEDNESDAY_EVENT = {
  id: "abc",
  title: "There Ain’t a L Street in Robla",
  fullUrl: "/events/nw4ysdkprm5wrtzg96bbhghjkj8ss2",
  startDate: Date.UTC(2026, 4, 28, 1, 30, 0),
  endDate: Date.UTC(2026, 4, 28, 4, 30, 0),
  location: {
    addressTitle: "",
    addressLine1: "",
    addressLine2: "",
  },
  body: "<p>The hare <strong>Shitmare</strong> says...</p>",
};

const CAMPOUT_EVENT = {
  id: "def",
  title: "Hash Olympdicks Campout",
  fullUrl: "/events/lambmdf4phx4pskctn2hlqsukv00ux",
  startDate: Date.UTC(2026, 5, 5, 20, 0, 0),
  endDate: Date.UTC(2026, 5, 7, 19, 0, 0),
  location: {
    addressTitle: "Black Miner Bar",
    addressLine1: "9875 Greenback Lane",
    addressLine2: "Folsom, CA, 95630",
    mapLat: 38.6844644,
    mapLng: -121.1788914,
    markerLat: 40.7207559,  // Squarespace's NYC fallback pin — must NOT be used
    markerLng: -74.0007613,
  },
  body: "<p>Three-day campout. Dog friendly. 21+.</p>",
};

const NUMBERED_PAST_EVENT = {
  id: "ghi",
  title: "Inky's Birthday Trail (#1726)",
  fullUrl: "/events/inkys-birthday",
  startDate: Date.UTC(2026, 3, 30, 1, 30, 0), // 2026-04-29 18:30 PDT
  endDate: Date.UTC(2026, 3, 30, 4, 30, 0),
  location: { addressTitle: "Johnson-Springview Park, Rocklin" },
  body: "",
};

describe("parseSquarespaceEvent", () => {
  it("converts epoch-ms startDate to local YYYY-MM-DD in the site timezone", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev).not.toBeNull();
    // 2026-05-28 01:30 UTC = 2026-05-27 18:30 PDT
    expect(ev?.date).toBe("2026-05-27");
    expect(ev?.startTime).toBe("18:30");
  });

  it("extracts run number from `(#NNNN)` title form", () => {
    const ev = parseSquarespaceEvent(NUMBERED_PAST_EVENT, CONFIG, BASE, PT);
    expect(ev?.runNumber).toBe(1726);
    expect(ev?.title).toBe("Inky's Birthday Trail (#1726)");
  });

  it("composes a multi-line street address when both lines are present", () => {
    const ev = parseSquarespaceEvent(CAMPOUT_EVENT, CONFIG, BASE, PT);
    expect(ev?.location).toBe("Black Miner Bar");
    expect(ev?.locationStreet).toBe("9875 Greenback Lane, Folsom, CA, 95630");
  });

  it("emits endDate for multi-day events when the end day is after the start day", () => {
    const ev = parseSquarespaceEvent(CAMPOUT_EVENT, CONFIG, BASE, PT);
    expect(ev?.date).toBe("2026-06-05");
    expect(ev?.endDate).toBe("2026-06-07");
  });

  it("omits endDate for same-day evening trails (no spurious fingerprint churn)", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.endDate).toBeUndefined();
  });

  it("reads latitude/longitude from mapLat/mapLng (NOT markerLat/markerLng)", () => {
    const ev = parseSquarespaceEvent(CAMPOUT_EVENT, CONFIG, BASE, PT);
    expect(ev?.latitude).toBe(38.6844644);
    expect(ev?.longitude).toBe(-121.1788914);
  });

  it("leaves latitude/longitude undefined when mapLat/mapLng are absent", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.latitude).toBeUndefined();
    expect(ev?.longitude).toBeUndefined();
  });

  it("leaves location/locationStreet undefined when address fields are blank", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.location).toBeUndefined();
    expect(ev?.locationStreet).toBeUndefined();
  });

  it("strips HTML tags from body for description", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.description).toBe("The hare Shitmare says...");
  });

  it("returns null when startDate is missing or zero", () => {
    expect(
      parseSquarespaceEvent({ title: "x" }, CONFIG, BASE, PT),
    ).toBeNull();
    expect(
      parseSquarespaceEvent({ title: "x", startDate: 0 }, CONFIG, BASE, PT),
    ).toBeNull();
  });

  it("resolves fullUrl against the base for sourceUrl", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.sourceUrl).toBe(
      "https://sach3.beer/events/nw4ysdkprm5wrtzg96bbhghjkj8ss2",
    );
  });

  it("emits the configured kennelTag", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.kennelTags).toEqual(["sach3"]);
  });
});

function mockJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("SquarespaceEventsAdapter.fetch", () => {
  const adapter = new SquarespaceEventsAdapter();

  it("parses upcoming + past arrays into RawEvents", async () => {
    const payload = {
      website: { timeZone: PT, baseUrl: BASE },
      upcoming: [WEDNESDAY_EVENT, CAMPOUT_EVENT],
      past: [NUMBERED_PAST_EVENT],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse(payload));

    const source = buildSource({
      url: BASE,
      type: "HTML_SCRAPER",
      scrapeDays: 365,
    }) as unknown as Source;
    (source as unknown as { config: unknown }).config = { kennelTag: "sach3" };

    const result = await adapter.fetch(source, { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(3);
    expect(
      result.events.map((e) => e.date).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["2026-04-29", "2026-05-27", "2026-06-05"]);
    expect(result.diagnosticContext?.fetchMethod).toBe(
      "squarespace-events-json",
    );
    expect(result.diagnosticContext?.timezone).toBe(PT);
  });

  it("fails loud when the JSON parses to null or a non-object", async () => {
    // `JSON.parse("null")` succeeds with the literal `null`. Without the
    // guard the subsequent payload.upcoming access throws TypeError.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse(null));

    const source = buildSource({ url: BASE }) as unknown as Source;
    (source as unknown as { config: unknown }).config = { kennelTag: "sach3" };

    const result = await adapter.fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/is not an object/);
  });

  it("skips null entries inside upcoming/past arrays without crashing", async () => {
    const payload = {
      website: { timeZone: PT },
      upcoming: [WEDNESDAY_EVENT, null, "not an event"],
      past: [null],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse(payload));

    const source = buildSource({ url: BASE }) as unknown as Source;
    (source as unknown as { config: unknown }).config = { kennelTag: "sach3" };

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.date).toBe("2026-05-27");
  });

  it("fails loud when the JSON has neither upcoming nor past arrays", async () => {
    // Tenant disabled the Events collection but still serves a JSON page.
    // If we silently returned 0 events here the reconciler would cancel
    // every live event for this source — fail loud instead.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockJsonResponse({ website: { timeZone: PT } }),
    );

    const source = buildSource({ url: BASE }) as unknown as Source;
    (source as unknown as { config: unknown }).config = { kennelTag: "sach3" };

    const result = await adapter.fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/no 'upcoming' or 'past' arrays/);
    expect(result.errorDetails?.parse).toHaveLength(1);
  });

  it("surfaces a fetch error when the tenant returns HTML instead of JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html;charset=utf-8" },
      }),
    );

    const source = buildSource({ url: BASE }) as unknown as Source;
    (source as unknown as { config: unknown }).config = { kennelTag: "sach3" };

    const result = await adapter.fetch(source, { days: 90 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Expected JSON/);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });

  it("throws a descriptive error when kennelTag config is missing", async () => {
    const source = buildSource({ url: BASE }) as unknown as Source;
    (source as unknown as { config: unknown }).config = {};

    await expect(adapter.fetch(source)).rejects.toThrow(
      /missing required config field "kennelTag"/,
    );
  });
});
