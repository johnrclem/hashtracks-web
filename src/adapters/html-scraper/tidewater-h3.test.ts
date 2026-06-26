import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  TidewaterH3Adapter,
  extractCalendarArray,
  parseCalendarEntry,
  parseTidewaterCalendar,
  parseSpecialEvents,
  parseRunNumber,
  parseTrailLength,
  parseShiggy,
  parseDetailGrid,
  resolveKennel,
} from "./tidewater-h3";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-twh3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://tidewaterh3.org/calendar";
const NOW = new Date("2026-06-26T12:00:00Z");

const CALENDAR_HTML = readFileSync(
  path.join(__dirname, "fixtures/tidewater-h3-calendar-2026-06-26.html.fixture"),
  "utf-8",
);
const DETAIL_HTML = readFileSync(
  path.join(__dirname, "fixtures/tidewater-h3-detail-th3-1852-2026-06-26.html.fixture"),
  "utf-8",
);
const EVENTS_HTML = readFileSync(
  path.join(__dirname, "fixtures/tidewater-h3-upcoming-events-2026-06-26.html.fixture"),
  "utf-8",
);

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-twh3-cal",
    name: "Tidewater H3 Website Calendar",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 120,
    config: { upcomingOnly: true },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

afterEach(() => {
  vi.useRealTimers();
  mockedSafeFetch.mockReset();
});

describe("extractCalendarArray", () => {
  it("extracts the inline trailCalendarEvents feed", () => {
    const arr = extractCalendarArray(CALENDAR_HTML);
    expect(arr).not.toBeNull();
    expect(arr!.length).toBe(143);
  });

  it("returns null when the island is absent", () => {
    expect(extractCalendarArray("<html><body>no feed here</body></html>")).toBeNull();
  });

  it("returns null on a malformed island", () => {
    expect(extractCalendarArray("const trailCalendarEvents = [ {oops ];")).toBeNull();
  });
});

describe("resolveKennel", () => {
  it("routes each pill code to its kennel", () => {
    expect(resolveKennel({ title: "TH3" }).code).toBe("twh3");
    expect(resolveKennel({ title: "T3H3" }).code).toBe("t3h3-va");
    expect(resolveKennel({ title: "HOBOH3" }).code).toBe("hoboh3");
    expect(resolveKennel({ title: "VBFMH3" }).code).toBe("vbfmh3");
    expect(resolveKennel({ title: "MoSH3" }).code).toBe("mosh3");
    expect(resolveKennel({ title: "TKDH3" }).code).toBe("tkdh3");
  });

  it("resolves via the kennel full name when the pill is unknown", () => {
    expect(resolveKennel({ extendedProps: { kennel: "HOBO Hash House Harriers" } })).toEqual({
      code: "hoboh3",
      known: true,
    });
  });

  it("fails closed on an unmapped kennel (unmapped-* tag, not the host)", () => {
    // An unrecognized kennel must NOT be misattributed to twh3 — it gets an
    // unmapped slug so the merge source-kennel guard blocks it (SOURCE_KENNEL_MISMATCH).
    expect(resolveKennel({ title: "ZZZH3", extendedProps: { kennel: "Mystery H3" } })).toEqual({
      code: "unmapped-zzzh3",
      known: false,
    });
  });
});

describe("parseRunNumber", () => {
  it("parses #NNNN markers", () => {
    expect(parseRunNumber("TH3 Trail #1852 - 2K BDay Trail")).toBe(1852);
  });
  it("parses a bare 'Trail NNNN'", () => {
    expect(parseRunNumber("Tuesday! Tuesday! Tuesday!  Trail 1169")).toBe(1169);
  });
  it("does not mistake a year for a run number", () => {
    expect(parseRunNumber("MoSH3 Lingerie ShiggyFest 2026")).toBeUndefined();
  });
  it("returns undefined for placeholder titles", () => {
    expect(parseRunNumber("TH3 Regular Trail")).toBeUndefined();
  });
});

describe("parseTrailLength", () => {
  it("parses a range", () => {
    expect(parseTrailLength("2-4 Miles")).toEqual({ text: "2-4 Miles", min: 2, max: 4 });
  });
  it("parses a single value (min == max)", () => {
    expect(parseTrailLength("2.69")).toEqual({ text: "2.69", min: 2.69, max: 2.69 });
  });
  it("keeps verbatim text but clears bounds when unparseable (atomic bundle)", () => {
    expect(parseTrailLength("Yes")).toEqual({ text: "Yes", min: null, max: null });
  });
  it("treats TBD/empty as no value", () => {
    expect(parseTrailLength("TBD")).toEqual({ text: null, min: null, max: null });
    expect(parseTrailLength(undefined)).toEqual({ text: null, min: null, max: null });
  });
});

describe("parseShiggy", () => {
  it("rounds a decimal within 1-5 to an Int", () => {
    expect(parseShiggy("3.69")).toEqual({ difficulty: 4, text: "3.69" });
    expect(parseShiggy("1.69")).toEqual({ difficulty: 2, text: "1.69" });
  });
  it("rejects out-of-range values (keeps text)", () => {
    expect(parseShiggy("7")).toEqual({ difficulty: null, text: "7" });
  });
  it("returns null difficulty when no number present", () => {
    expect(parseShiggy("Yes")).toEqual({ difficulty: null, text: "Yes" });
  });
});

describe("parseCalendarEntry", () => {
  it("maps a real trail with coords + run number", () => {
    const arr = extractCalendarArray(CALENDAR_HTML)!;
    const raw = arr.find((e) => e.id === "trail-6")!; // TH3 #1852
    const parsed = parseCalendarEntry(raw, SOURCE_URL)!;
    expect(parsed.isPlaceholder).toBe(false);
    expect(parsed.event.kennelTags).toEqual(["twh3"]);
    expect(parsed.event.runNumber).toBe(1852);
    expect(parsed.event.date).toBe("2026-06-28");
    expect(parsed.event.startTime).toBe("14:00");
    expect(parsed.event.hares).toMatch(/Walk 2,000 Miles/);
    expect(parsed.event.latitude).toBeCloseTo(36.905459, 4);
    expect(parsed.event.longitude).toBeCloseTo(-76.098743, 4);
    expect(parsed.event.location).toBe("Loch Haven Park");
    expect(parsed.event.sourceUrl).toContain("/trail/th3-trail-1852");
    expect(parsed.event.description).toMatch(/Gather: 1:30 PM/);
  });

  it("maps a street-address trail to locationStreet", () => {
    const arr = extractCalendarArray(CALENDAR_HTML)!;
    const raw = arr.find((e) => e.id === "trail-10")!; // VBFMH3
    const parsed = parseCalendarEntry(raw, SOURCE_URL)!;
    expect(parsed.event.kennelTags).toEqual(["vbfmh3"]);
    expect(parsed.event.locationStreet).toMatch(/Bayville Park/);
    expect(parsed.event.latitude).toBeUndefined();
    expect(parsed.event.locationUrl).toContain("google.com/maps");
  });

  it("drops TBD hares + boilerplate description on placeholders", () => {
    const arr = extractCalendarArray(CALENDAR_HTML)!;
    const placeholder = arr.find((e) => e.extendedProps?.type === "schedule")!;
    const parsed = parseCalendarEntry(placeholder, SOURCE_URL)!;
    expect(parsed.isPlaceholder).toBe(true);
    expect(parsed.event.hares).toBeUndefined();
    expect(parsed.event.runNumber).toBeUndefined();
    // gather line kept, boilerplate placeholder prose dropped
    expect(parsed.event.description ?? "").not.toMatch(/Regularly scheduled trail placeholder/);
  });
});

describe("parseTidewaterCalendar (windowing)", () => {
  it("keeps real events + in-window placeholders, drops past + far-future", () => {
    const { events, rawCount, unknownKennels } = parseTidewaterCalendar(CALENDAR_HTML, {
      now: NOW,
      days: 120,
      sourceUrl: SOURCE_URL,
    });
    expect(rawCount).toBe(143);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(143); // far-future placeholders dropped
    expect(unknownKennels).toEqual([]); // all 6 kennels recognized

    const min = Math.min(...events.map((e) => new Date(e.date + "T12:00:00Z").getTime()));
    const yesterday = NOW.getTime() - 2 * 24 * 60 * 60 * 1000;
    expect(min).toBeGreaterThan(yesterday); // no past events

    // The Nov special event survives the wider real-event window despite being
    // outside the 120-day placeholder window.
    const nov = events.find((e) => e.date === "2026-11-13");
    expect(nov).toBeDefined();
    expect(nov!.kennelTags).toEqual(["twh3"]);

    // All six kennels appear.
    const kennels = new Set(events.flatMap((e) => e.kennelTags));
    expect(kennels).toEqual(new Set(["twh3", "t3h3-va", "hoboh3", "vbfmh3", "mosh3", "tkdh3"]));
  });

  it("returns rawCount 0 when the feed is missing", () => {
    const { events, rawCount } = parseTidewaterCalendar("<html></html>", {
      now: NOW,
      sourceUrl: SOURCE_URL,
    });
    expect(rawCount).toBe(0);
    expect(events).toEqual([]);
  });

  it("fails closed on an unmapped kennel: emits an unmapped-* tag, not twh3", () => {
    const feed = JSON.stringify([
      {
        id: "trail-x",
        title: "FOOH3",
        start: "2026-06-28T13:30:00",
        url: "/trail/foo",
        extendedProps: { type: "trail", title: "FOOH3 Trail #5", kennel: "Foo Hash", startTime: "2:00 PM" },
      },
    ]);
    const html = `<script>const trailCalendarEvents = ${feed};</script>`;
    const { events, unknownKennels } = parseTidewaterCalendar(html, {
      now: NOW,
      days: 120,
      sourceUrl: SOURCE_URL,
    });
    expect(events).toHaveLength(1);
    expect(events[0].kennelTags).toEqual(["unmapped-fooh3"]);
    expect(events[0].kennelTags).not.toContain("twh3");
    expect(unknownKennels).toContain("FOOH3 / Foo Hash");
  });
});

describe("parseSpecialEvents", () => {
  it("parses multi-day campouts with endDate, HashRego link, cost, hares", () => {
    const { events, unknownKennels } = parseSpecialEvents(EVENTS_HTML, {
      now: NOW,
      sourceUrl: SOURCE_URL,
    });
    expect(events.length).toBe(3);
    expect(unknownKennels).toEqual([]);

    const dining = events.find((e) => e.title?.includes("Dining-In"))!;
    expect(dining.kennelTags).toEqual(["twh3"]);
    expect(dining.date).toBe("2026-11-13");
    expect(dining.endDate).toBe("2026-11-15");
    expect(dining.startTime).toBe("16:00");
    expect(dining.cost).toBe("$150");
    expect(dining.hares).toMatch(/Penis Land/);
    expect(dining.locationStreet).toMatch(/Woodlake/);
    expect(dining.externalLinks?.[0]).toEqual({
      url: "https://hashrego.com/events/th3-th3-hashy-dining-in-round-iii-2026-2026",
      label: "Hash Rego",
    });
    expect(dining.sourceUrl).toContain("/event/th3-hashy-dining-in");
    expect(dining.description).toMatch(/Veteran Appreciation Weekend/);
  });

  it("routes TKDH3 via host name despite the kdh3.png logo, and parses coords", () => {
    const { events } = parseSpecialEvents(EVENTS_HTML, { now: NOW, sourceUrl: SOURCE_URL });
    const elvis = events.find((e) => e.title?.includes("Dead ELVIS"))!;
    expect(elvis.kennelTags).toEqual(["tkdh3"]);
    expect(elvis.endDate).toBe("2026-08-23");
    expect(elvis.latitude).toBeCloseTo(36.62267, 3);
    expect(elvis.longitude).toBeCloseTo(-76.59815, 3);
    expect(elvis.locationStreet).toBeUndefined();

    const shiggyfest = events.find((e) => e.title?.includes("ShiggyFest"))!;
    expect(shiggyfest.kennelTags).toEqual(["mosh3"]);
  });

  it("returns [] when there are no special-event cards", () => {
    expect(
      parseSpecialEvents("<html><body>nothing</body></html>", { now: NOW, sourceUrl: SOURCE_URL }).events,
    ).toEqual([]);
  });
});

describe("parseDetailGrid", () => {
  it("extracts length + shiggy + trail type from a detail page", () => {
    const grid = parseDetailGrid(DETAIL_HTML);
    expect(grid.trailLengthText).toBe("2-4 Miles");
    expect(grid.trailLengthMinMiles).toBe(2);
    expect(grid.trailLengthMaxMiles).toBe(4);
    expect(grid.difficulty).toBe(4); // 3.69 rounded
    expect(grid.shiggyText).toBe("3.69");
    expect(grid.trailType).toBe("A to A");
  });
});

describe("TidewaterH3Adapter.fetch", () => {
  function mockByUrl() {
    mockedSafeFetch.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      let body = CALENDAR_HTML;
      if (u.includes("/upcoming-events")) body = EVENTS_HTML;
      else if (u.includes("/trail/") || u.includes("/event/")) body = DETAIL_HTML;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });
  }

  it("fetches the calendar + events page, windows, enriches, and de-dupes specials", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockByUrl();

    const result = await new TidewaterH3Adapter().fetch(makeSource(), { days: 120 });

    expect(result.errors).toEqual([]);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.diagnosticContext?.specialEvents).toBe(3);

    // Real TH3 #1852 enriched from its detail page.
    const th3 = result.events.find((e) => e.runNumber === 1852)!;
    expect(th3).toBeDefined();
    expect(th3.trailLengthText).toBe("2-4 Miles");
    expect(th3.difficulty).toBe(4);
    expect(th3.trailType).toBe("A to A");
    expect(th3.description).toMatch(/Shiggy: 3\.69/);

    // The Dining-In special appears exactly once — the rich multi-day card from
    // /upcoming-events, not a duplicate of the calendar's bare type:event entry.
    const dining = result.events.filter((e) => e.title?.includes("Dining-In"));
    expect(dining.length).toBe(1);
    expect(dining[0].endDate).toBe("2026-11-15");
    expect(dining[0].externalLinks?.[0].label).toBe("Hash Rego");

    // All six kennels are represented across calendar + special events.
    const kennels = new Set(result.events.flatMap((e) => e.kennelTags));
    expect(kennels).toEqual(new Set(["twh3", "t3h3-va", "hoboh3", "vbfmh3", "mosh3", "tkdh3"]));
  });

  it("fails loud (no empty-success) when the feed island is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockedSafeFetch.mockResolvedValue(
      new Response("<html><body>maintenance</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await new TidewaterH3Adapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/No trailCalendarEvents feed/);
  });
});
