import type { Source } from "@/generated/prisma/client";
import {
  formatMonthParam,
  listWindowMonths,
  parseSquarespaceEvent,
  resolveCollectionUrl,
  SquarespaceEventsAdapter,
  type SquarespaceEventsConfig,
} from "./squarespace-events";
import { buildSource } from "@/test/factories";
import { formatYmdInTimezone } from "@/lib/timezone";

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
    // Squarespace populates `markerLat`/`markerLng` with the tenant default
    // (Manhattan, NY) for every event regardless of where the user pins the
    // venue. Since this fixture has a real venue pin, the map pair differs
    // from the marker pair → the adapter should emit the real Folsom coords.
    markerLat: 40.7207559,
    markerLng: -74.0007613,
  },
  body: "<p>Three-day campout. Dog friendly. 21+.</p>",
};

// Real-world Squarespace shape when the user enters a street address but
// doesn't drop a map pin — both lat/lng pairs collapse to the tenant
// default (Manhattan, NY). 16 of 38 SACH3 events on first scrape landed
// with these coords despite having Sacramento street addresses (#1742
// follow-up).
const UNSET_PIN_EVENT = {
  id: "ghi-unset",
  title: "Saturday Trail (no pin)",
  fullUrl: "/events/saturday-trail-no-pin",
  startDate: Date.UTC(2026, 6, 11, 1, 30, 0),
  endDate: Date.UTC(2026, 6, 11, 4, 30, 0),
  location: {
    addressTitle: "",
    addressLine1: "11351 S Bridge St,",
    addressLine2: "Gold River, CA 95670",
    mapLat: 40.7207559,
    mapLng: -74.0007613,
    markerLat: 40.7207559,
    markerLng: -74.0007613,
  },
  body: "",
};

// #1933: Squarespace addressTitle (venue name) left blank but a real street
// address entered. 15 of 37 SACH3 events shipped this shape — locationName
// rendered null despite the street being populated. The composed street must
// fall back into the displayable locationName.
const BLANK_TITLE_WITH_STREET_EVENT = {
  id: "shigfest",
  title: "Summer Shigfest with Leglifter",
  fullUrl: "/events/th5nnh7fd5wzmapnp9c8fs6cgd86wa",
  startDate: Date.UTC(2026, 5, 4, 1, 30, 0), // 2026-06-03 18:30 PDT
  endDate: Date.UTC(2026, 5, 4, 4, 30, 0),
  location: {
    addressTitle: "",
    addressLine1: "520 North Sunrise Avenue",
    addressLine2: "Roseville, California, 95661",
  },
  body: "",
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

describe("resolveCollectionUrl", () => {
  it("appends a non-default collectionPath to a bare-domain base URL (VTH3 #1941)", () => {
    // VTH3's Events collection lives at /hareline, not the adapter default
    // /events. A bare-domain base URL + collectionPath must resolve to the
    // hareline collection, never /events.
    expect(resolveCollectionUrl("https://www.vontramph3.com", "/hareline")).toBe(
      "https://www.vontramph3.com/hareline?format=json",
    );
  });

  it("does not double-append when the base URL already includes the collection path", () => {
    expect(
      resolveCollectionUrl("https://www.vontramph3.com/hareline", "/hareline"),
    ).toBe("https://www.vontramph3.com/hareline?format=json");
    // Trailing slash on the base path is tolerated.
    expect(
      resolveCollectionUrl("https://www.vontramph3.com/hareline/", "/hareline"),
    ).toBe("https://www.vontramph3.com/hareline?format=json");
  });

  it("falls back to the default /events collection (Sacramento)", () => {
    expect(resolveCollectionUrl("https://sach3.beer", "/events")).toBe(
      "https://sach3.beer/events?format=json",
    );
  });
});

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

  it("falls back to the composed street for locationName when addressTitle is blank (#1933)", () => {
    const ev = parseSquarespaceEvent(
      BLANK_TITLE_WITH_STREET_EVENT,
      CONFIG,
      BASE,
      PT,
    );
    expect(ev?.location).toBe(
      "520 North Sunrise Avenue, Roseville, California, 95661",
    );
    expect(ev?.locationStreet).toBe(
      "520 North Sunrise Avenue, Roseville, California, 95661",
    );
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

  it("emits endTime for same-day events when endDate epoch is later than start", () => {
    // 2026-05-27 18:30 PDT → 2026-05-27 21:30 PDT (3-hour Wednesday trail).
    // EventCard renders "18:30 – 21:30" once endTime is populated.
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.startTime).toBe("18:30");
    expect(ev?.endTime).toBe("21:30");
  });

  it("omits endTime for multi-day events (endDate flows instead)", () => {
    // Multi-day Hash Olympdicks Campout — endDate populates instead of endTime
    // so the UI knows this is a 3-day umbrella, not a single evening trail.
    const ev = parseSquarespaceEvent(CAMPOUT_EVENT, CONFIG, BASE, PT);
    expect(ev?.endDate).toBe("2026-06-07");
    expect(ev?.endTime).toBeUndefined();
  });

  it("omits endTime when endDate is missing or ≤ startDate", () => {
    const ev1 = parseSquarespaceEvent(
      { ...WEDNESDAY_EVENT, endDate: undefined },
      CONFIG,
      BASE,
      PT,
    );
    expect(ev1?.endTime).toBeUndefined();
    const ev2 = parseSquarespaceEvent(
      { ...WEDNESDAY_EVENT, endDate: WEDNESDAY_EVENT.startDate }, // equal, not >
      CONFIG,
      BASE,
      PT,
    );
    expect(ev2?.endTime).toBeUndefined();
  });

  it("reads latitude/longitude from mapLat/mapLng when the user pinned a venue", () => {
    const ev = parseSquarespaceEvent(CAMPOUT_EVENT, CONFIG, BASE, PT);
    expect(ev?.latitude).toBe(38.6844644);
    expect(ev?.longitude).toBe(-121.1788914);
  });

  it("leaves latitude/longitude undefined when mapLat/mapLng are absent", () => {
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.latitude).toBeUndefined();
    expect(ev?.longitude).toBeUndefined();
  });

  it("rejects the tenant-default pin when mapLat/mapLng equal markerLat/markerLng", () => {
    // Regression test for the 16-of-38 Manhattan-coord leak on the initial
    // SACH3 scrape: Squarespace's mapLat/mapLng silently fall back to the
    // tenant default (~40.72/-74.00 Manhattan) when no venue pin is set.
    // Equality between mapLat/mapLng and markerLat/markerLng is the canonical
    // "unset pin" signal — those coords must not be emitted.
    const ev = parseSquarespaceEvent(UNSET_PIN_EVENT, CONFIG, BASE, PT);
    expect(ev?.latitude).toBeUndefined();
    expect(ev?.longitude).toBeUndefined();
    // But the address still flows through so the downstream geocoder can
    // derive correct coords.
    expect(ev?.locationStreet).toBe("11351 S Bridge St,, Gold River, CA 95670");
  });

  it("emits dropCachedCoords when the tenant-default pin is rejected", () => {
    // Without this signal the merge pipeline's existing-coords cache
    // short-circuit preserves the previously-stored Manhattan default
    // forever (#957 precedent). The post-merge re-scrape after PR #1745
    // landed with 16 events still on Manhattan coords for exactly this
    // reason — the adapter was emitting `latitude: undefined` but not
    // signaling that the OLD coords were stale.
    const ev = parseSquarespaceEvent(UNSET_PIN_EVENT, CONFIG, BASE, PT);
    expect(ev?.dropCachedCoords).toBe(true);
  });

  it("does NOT emit dropCachedCoords when the user actually pinned a venue", () => {
    // Real venue pin → coords are legit, no need to invalidate any cache.
    const ev = parseSquarespaceEvent(CAMPOUT_EVENT, CONFIG, BASE, PT);
    expect(ev?.dropCachedCoords).toBeUndefined();
    expect(ev?.latitude).toBe(38.6844644);
  });

  it("does NOT emit dropCachedCoords when location has no coord fields at all", () => {
    // No mapLat/mapLng → no upstream coords to reject; legitimate
    // "geocode from address" case, not a stale-pin scenario.
    const ev = parseSquarespaceEvent(WEDNESDAY_EVENT, CONFIG, BASE, PT);
    expect(ev?.dropCachedCoords).toBeUndefined();
    expect(ev?.latitude).toBeUndefined();
  });

  it("rejects a pin on an event with no address text (VTH3 Grafton County default, #2426)", () => {
    // Verbatim location from vontramph3.com/hareline?format=json for
    // "VTH3 Trail #100: Ragnarök" (2026-11-05): no venue text, mapLat set to
    // a second tenant default in Grafton County, NH that differs from the
    // Manhattan marker default — reverse-geocoded as "Warren, NH".
    const ev = parseSquarespaceEvent(
      {
        ...UNSET_PIN_EVENT,
        title: "VTH3 Trail #100: Ragnarök",
        location: {
          addressTitle: "",
          addressLine1: "",
          addressLine2: "",
          mapLat: 43.9087929,
          mapLng: -71.825994,
          markerLat: 40.7207559,
          markerLng: -74.0007613,
        },
      },
      CONFIG,
      BASE,
      PT,
    );
    expect(ev?.latitude).toBeUndefined();
    expect(ev?.longitude).toBeUndefined();
    expect(ev?.dropCachedCoords).toBe(true);
    expect(ev?.location).toBeUndefined();
  });

  it("emits coords when mapLat/mapLng differ from markerLat/markerLng even by a small margin", () => {
    // Defense against false-positives: a kennel whose real venue happens to
    // be near the Squarespace default must still get coords if the user
    // actively positioned the pin (mapLat ≠ markerLat).
    const ev = parseSquarespaceEvent(
      {
        ...UNSET_PIN_EVENT,
        location: {
          ...UNSET_PIN_EVENT.location,
          mapLat: 40.7300000, // user nudged pin ~1km north of default
          mapLng: -74.0050000,
          markerLat: 40.7207559,
          markerLng: -74.0007613,
        },
      },
      CONFIG,
      BASE,
      PT,
    );
    expect(ev?.latitude).toBe(40.73);
    expect(ev?.longitude).toBe(-74.005);
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

/** A month payload as Squarespace serves it for `?month=MM-YYYY`. */
function monthPayload(past: unknown[] = [], upcoming: unknown[] = []) {
  return { website: { timeZone: PT }, upcoming, past, monthFilter: 1 };
}

/** An event-less month, as served live: `empty: true` and no arrays at all. */
const EMPTY_MONTH = { website: { timeZone: PT }, monthFilter: 1, empty: true, emptyFolder: false };

type MockBody = unknown | (() => Response);

/**
 * Route mocked fetches by URL: the base collection page, then month pages
 * keyed by their "MM-YYYY" filter. Unlisted months get EMPTY_MONTH.
 * Routing (not `mockResolvedValueOnce` queues) because months are fetched
 * several at a time.
 */
function routeFetch(base: MockBody, months: Record<string, MockBody> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const month = url.searchParams.get("month");
    let body: MockBody;
    if (month === null) body = base;
    else body = month in months ? months[month] : EMPTY_MONTH;
    return typeof body === "function" ? (body as () => Response)() : mockJsonResponse(body);
  });
}

function sourceWith(config: Record<string, unknown>): Source {
  const source = buildSource({ url: BASE, type: "HTML_SCRAPER", scrapeDays: 365 }) as unknown as Source;
  (source as unknown as { config: unknown }).config = config;
  return source;
}

function requestedUrls(spy: ReturnType<typeof routeFetch>): URL[] {
  return spy.mock.calls.map(([input]) => new URL(String(input)));
}

describe("SquarespaceEventsAdapter.fetch", () => {
  const adapter = new SquarespaceEventsAdapter();

  // Reset the global fetch spy between tests — `vi.spyOn(globalThis, "fetch")`
  // returns the SAME underlying spy across re-spy calls, so .mock.calls
  // accumulates across tests. Restore-all clears both the call history and
  // the mock implementation.
  beforeEach(() => {
    vi.restoreAllMocks();
    // Freeze "now" inside the fixtures' date span (2026-04-29 → 2026-07-10) so the
    // adapter's ±days window (applyDateWindow) never ages the hardcoded fixture
    // dates out and redlights CI — the same time-bomb that hit atlanta-hash-board
    // on 2026-06-08. Every test here asserts events flow THROUGH the window (none
    // test now-relative exclusion), so a fixed reference date is safe. Date-only
    // faking keeps setTimeout real so the awaited fetch mocks still resolve.
    // The month-walk tests further down use relative dates instead.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses upcoming + past arrays into RawEvents", async () => {
    routeFetch({
      website: { timeZone: PT, baseUrl: BASE },
      upcoming: [WEDNESDAY_EVENT, CAMPOUT_EVENT],
      past: [NUMBERED_PAST_EVENT],
    });

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
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
    const spy = routeFetch(null);

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }));
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/is not an object/);
    // A broken base page stops the scrape before any month is fetched.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("skips null entries inside upcoming/past arrays without crashing", async () => {
    routeFetch({
      website: { timeZone: PT },
      upcoming: [WEDNESDAY_EVENT, null, "not an event"],
      past: [null],
    });

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.date).toBe("2026-05-27");
  });

  it("fails loud when the JSON has neither upcoming nor past arrays", async () => {
    // Tenant disabled the Events collection but still serves a JSON page.
    // If we silently returned 0 events here the reconciler would cancel
    // every live event for this source — fail loud instead.
    routeFetch({ website: { timeZone: PT } });

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }));
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/no 'upcoming' or 'past' arrays/);
    expect(result.errorDetails?.parse).toHaveLength(1);
  });

  it("surfaces a fetch error when the tenant returns HTML instead of JSON", async () => {
    routeFetch(
      () =>
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "content-type": "text/html;charset=utf-8" },
        }),
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 90 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Expected JSON/);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });

  it("throws a descriptive error when kennelTag config is missing", async () => {
    await expect(adapter.fetch(sourceWith({}))).rejects.toThrow(
      /missing required config field "kennelTag"/,
    );
  });

  it("isolates a per-event parse failure so siblings still flow through", async () => {
    // A numeric `title` survives the JSON round-trip but makes
    // parseSquarespaceEvent throw (`title?.trim is not a function`). Without
    // the per-row try/catch the campout would never be emitted.
    routeFetch({
      website: { timeZone: PT },
      upcoming: [
        { ...WEDNESDAY_EVENT, title: 42 }, // 42.trim() throws TypeError
        CAMPOUT_EVENT,
      ],
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }));

    // The campout still gets through; the TypeError is logged, not thrown.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.title).toBe("Hash Olympdicks Campout");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse one event row"),
      expect.stringContaining("trim is not a function"),
    );
  });
});

describe("listWindowMonths", () => {
  // `now` is passed in, so these stay fixed no matter when CI runs.
  const NOW = new Date("2026-11-07T20:00:00Z"); // 2026-11-07 12:00 PST

  it("lists every month from the window start through the current month, oldest first", () => {
    const months = listWindowMonths(NOW, 365, PT).months.map(formatMonthParam);
    expect(months[0]).toBe("11-2025");
    expect(months.at(-1)).toBe("11-2026");
    expect(months).toHaveLength(13);
  });

  it("walks only the current month for a zero, negative or non-numeric window", () => {
    for (const days of [0, -5, Number.NaN]) {
      expect(listWindowMonths(NOW, days, PT).months.map(formatMonthParam)).toEqual(["11-2026"]);
    }
  });

  it("adds a day of slack so a window starting on the 1st also covers the prior month's last day", () => {
    // now - 6 days = 2026-11-01 (PST). applyDateWindow can still keep an
    // Oct 31 run, so October must be walked too.
    expect(listWindowMonths(NOW, 6, PT).months.map(formatMonthParam)).toEqual(["10-2026", "11-2026"]);
  });

  it("takes month boundaries from the site timezone, not UTC", () => {
    // 2026-12-01T03:00Z is still Nov 30 in Sacramento.
    const lateNov = new Date("2026-12-01T03:00:00Z");
    expect(listWindowMonths(lateNov, 1, PT).months.map(formatMonthParam)).toEqual(["11-2026"]);
    expect(listWindowMonths(lateNov, 1, "UTC").months.map(formatMonthParam)).toEqual(["11-2026", "12-2026"]);
  });

  it("keeps only the newest 600 months of an absurd window and reports the cap", () => {
    const { months, capped } = listWindowMonths(NOW, 1_000_000, PT);
    expect(capped).toBe(true);
    expect(months).toHaveLength(600);
    expect(formatMonthParam(months[months.length - 1])).toBe("11-2026");
    expect(listWindowMonths(NOW, 3650, PT).capped).toBe(false);
  });

  it("formats month params as MM-YYYY", () => {
    expect(formatMonthParam({ year: 2026, month: 3 })).toBe("03-2026");
    expect(formatMonthParam({ year: 2025, month: 12 })).toBe("12-2025");
  });
});

// Month-walk behaviour, on dates relative to the real clock so the fixtures
// never age out of the adapter's date window.
describe("SquarespaceEventsAdapter.fetch — month walk", () => {
  const adapter = new SquarespaceEventsAdapter();
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** A run `daysAgo` days back, plus the "MM-YYYY" month page it lives on. */
  function runDaysAgo(id: string, daysAgo: number, runNumber: number) {
    const startDate = Date.now() - daysAgo * DAY;
    const ymd = formatYmdInTimezone(new Date(startDate), PT);
    return {
      event: {
        id,
        title: `Trail (#${runNumber})`,
        fullUrl: `/events/${id}`,
        startDate,
        location: { addressTitle: "Some Park" },
        body: "",
      },
      ymd,
      month: `${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`,
    };
  }

  /** Group runs onto their month pages. */
  function monthPages(...runs: Array<ReturnType<typeof runDaysAgo>>): Record<string, unknown> {
    const pages: Record<string, unknown[]> = {};
    for (const run of runs) (pages[run.month] ??= []).push(run.event);
    return Object.fromEntries(Object.entries(pages).map(([m, past]) => [m, monthPayload(past)]));
  }

  it("fetches one ?month=MM-YYYY page per month in the window and never follows the offset chain", async () => {
    const spy = routeFetch({
      website: { timeZone: PT },
      upcoming: [],
      past: [],
      // The base page still advertises the publishOn offset chain.
      pagination: { nextPage: true, nextPageOffset: 1772656551673, pageSize: 30 },
    });

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    const expected = listWindowMonths(new Date(), 365, PT).months.map(formatMonthParam);
    const urls = requestedUrls(spy);

    expect(urls.some((u) => u.searchParams.has("offset"))).toBe(false);
    expect(urls.filter((u) => u.searchParams.has("month")).map((u) => u.searchParams.get("month")))
      .toEqual(expected);
    for (const u of urls) expect(u.searchParams.get("format")).toBe("json");
    expect(spy).toHaveBeenCalledTimes(1 + expected.length);
    expect(result.diagnosticContext?.monthsRequested).toBe(expected.length);
    expect(result.diagnosticContext?.monthsFetched).toBe(expected.length);
  });

  it("recovers runs that the publishOn-paged base listing leaves out (Sacramento #1719–#1730)", async () => {
    // The base page's `past` holds only the most recently published runs. The
    // older runs exist only on their month pages.
    const recent = runDaysAgo("recent", 10, 1760);
    const gapA = runDaysAgo("gap-a", 200, 1719);
    const gapB = runDaysAgo("gap-b", 195, 1720);
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [recent.event] },
      monthPages(recent, gapA, gapB),
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual([1719, 1720, 1760]);
    expect(result.events.find((e) => e.runNumber === 1719)?.date).toBe(gapA.ymd);
  });

  it("emits a run once when the base page and its month page both carry it", async () => {
    const shared = runDaysAgo("shared", 3, 1800);
    const future = { ...runDaysAgo("future", -5, 1801).event };
    routeFetch(
      { website: { timeZone: PT }, upcoming: [future], past: [shared.event] },
      // The current month page repeats both rows.
      { [shared.month]: monthPayload([shared.event], [future]) },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 30 });
    expect(result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual([1800, 1801]);
    expect(result.diagnosticContext?.duplicateRows).toBeGreaterThanOrEqual(1);
  });

  it("drops month-walk runs that fall outside options.days", async () => {
    const inside = runDaysAgo("inside", 20, 1900);
    const outside = runDaysAgo("outside", 75, 1890);
    // The oldest walked month starts before the window does, so its page can
    // carry runs older than `now - days`. Plant one there: the date window
    // must still trim it.
    const pages = monthPages(inside) as Record<string, ReturnType<typeof monthPayload>>;
    const oldest = formatMonthParam(listWindowMonths(new Date(), 30, PT).months[0]);
    pages[oldest] = monthPayload([...(pages[oldest]?.past ?? []), outside.event]);
    const spy = routeFetch({ website: { timeZone: PT }, upcoming: [], past: [] }, pages);

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 30 });
    expect(requestedUrls(spy).some((u) => u.searchParams.get("month") === oldest)).toBe(true);
    expect(result.events.map((e) => e.runNumber)).toEqual([1900]);
    expect(result.diagnosticContext?.totalBeforeFilter).toBe(2);
  });

  it("fails loud when a month fetch errors, keeps the other months' runs, and suppresses reconcile", async () => {
    const good = runDaysAgo("good", 10, 2000);
    const lost = runDaysAgo("lost", 100, 1990);
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      {
        ...monthPages(good),
        [lost.month]: () => new Response("oops", { status: 500, headers: { "content-type": "text/plain" } }),
      },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/HTTP 500/);
    expect(result.errors[0]).toContain(`month=${lost.month}`);
    expect(result.errorDetails?.fetch).toHaveLength(1);
    expect(result.events.map((e) => e.runNumber)).toEqual([2000]);
    expect(result.diagnosticContext?.failedMonths).toEqual([lost.month]);
    expect(result.diagnosticContext?.monthsFetched).toBe(
      (result.diagnosticContext?.monthsRequested as number) - 1,
    );
    expect(result.diagnosticContext?.kennelPageFetchErrors).toBe(1);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("month_fetch_failed");
    expect(result.pagination).toEqual({
      kennelPageFetchErrors: 1,
      kennelPagesStopReason: "month_fetch_failed",
    });
  });

  it("retries a month once, so a single transient failure doesn't fail the scrape", async () => {
    const run = runDaysAgo("flaky", 50, 2010);
    let calls = 0;
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      {
        [run.month]: () => {
          calls++;
          return calls === 1
            ? new Response("busy", { status: 503, headers: { "content-type": "text/plain" } })
            : mockJsonResponse(monthPayload([run.event]));
        },
      },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(calls).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([2010]);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBeNull();
  });

  it("does not retry a month that fails with a 4xx (it would just fail again)", async () => {
    const run = runDaysAgo("gone", 50, 2011);
    let calls = 0;
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      {
        [run.month]: () => {
          calls++;
          return new Response("nope", { status: 404, headers: { "content-type": "text/plain" } });
        },
      },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(calls).toBe(1);
    expect(result.errors[0]).toMatch(/HTTP 404/);
  });

  it("fails loud when a month fetch throws (network error)", async () => {
    const lost = runDaysAgo("lost", 60, 1995);
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      {
        [lost.month]: () => {
          throw new TypeError("fetch failed");
        },
      },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(result.errors[0]).toMatch(/Fetch failed: fetch failed/);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("month_fetch_failed");
  });

  it("fails loud when the tenant ignores the month filter", async () => {
    // No `monthFilter` echo: the tenant served the unfiltered, publishOn-paged
    // listing, which is exactly what the walk exists to avoid.
    const current = runDaysAgo("now", 0, 2100);
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      { [current.month]: { website: { timeZone: PT }, upcoming: [], past: [] } },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 30 });
    expect(result.errors.join(" ")).toMatch(/ignored the month filter/);
    expect(result.errorDetails?.parse?.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("month_fetch_failed");
  });

  it("accepts an `empty: true` month with no arrays (the live shape of an event-less month)", async () => {
    // Von Tramp's pre-2022 months and Sacramento's pre-Sep-2025 months all
    // come back like this. Treating them as shape breaks failed 64 months on
    // the first live run.
    const run = runDaysAgo("only", 15, 2300);
    const spy = routeFetch({ website: { timeZone: PT }, upcoming: [], past: [] }, monthPages(run));

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([2300]);
    // Every month but one was served as EMPTY_MONTH.
    expect(spy.mock.calls.length).toBeGreaterThan(3);
    expect(result.diagnosticContext?.monthsFetched).toBe(result.diagnosticContext?.monthsRequested);
  });

  it("fails loud when a month page has no upcoming/past arrays", async () => {
    const current = runDaysAgo("now", 0, 2100);
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      { [current.month]: { website: { timeZone: PT }, monthFilter: 1 } },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 30 });
    expect(result.errors.join(" ")).toMatch(/no 'upcoming' or 'past' arrays/);
  });

  it("fails loud on a paginated month page but keeps the runs it did return", async () => {
    const run = runDaysAgo("paged", 40, 2050);
    routeFetch(
      { website: { timeZone: PT }, upcoming: [], past: [] },
      {
        [run.month]: {
          ...monthPayload([run.event]),
          pagination: { nextPage: true, nextPageOffset: 123 },
        },
      },
    );

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(result.errors.join(" ")).toMatch(/is paginated/);
    expect(result.events.map((e) => e.runNumber)).toEqual([2050]);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("month_fetch_failed");
  });

  it("emits clean reconciliation signals when every month succeeds", async () => {
    // Otherwise reconcile would never run and stale events would pile up.
    const run = runDaysAgo("ok", 15, 2200);
    routeFetch({ website: { timeZone: PT }, upcoming: [], past: [] }, monthPages(run));

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.errorDetails).toBeUndefined();
    expect(result.diagnosticContext?.kennelPageFetchErrors).toBe(0);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBeNull();
    expect(result.pagination).toEqual({ kennelPageFetchErrors: 0, kennelPagesStopReason: null });
  });

  it("caps an absurd window at 600 month requests and marks the walk incomplete", async () => {
    const spy = routeFetch({ website: { timeZone: PT }, upcoming: [], past: [] });

    const result = await adapter.fetch(sourceWith({ kennelTag: "sach3" }), { days: 1_000_000 });
    expect(spy).toHaveBeenCalledTimes(1 + 600);
    expect(result.errors).toEqual([]);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("month_walk_capped");
    expect(result.pagination).toEqual({ kennelPageFetchErrors: 0, kennelPagesStopReason: "month_walk_capped" });
    // The newest months are the ones kept.
    const months = requestedUrls(spy).map((u) => u.searchParams.get("month")).filter(Boolean);
    expect(months.at(-1)).toBe(formatMonthParam(listWindowMonths(new Date(), 0, PT).months[0]));
  });
});
