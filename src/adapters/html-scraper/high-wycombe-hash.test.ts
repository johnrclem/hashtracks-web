import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  HighWycombeHashAdapter,
  normalizeUkPostcode,
  parseHwh3Date,
  parseHwh3Entry,
  parseHwh3RunNumbers,
} from "./high-wycombe-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-hwh3") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Real markup, trimmed from `curl -s https://www.hwh3.co.uk/` on 2026-11-10: a normal
// run, a two-hare run with `&amp;`, a "Venue TBA" row, and the Xmas Eve midday run
// (theme title with `&#039;`, a note, and a different start time).
const HOME_FIXTURE = `<div class="card"><h2>Runs list</h2><div class="runs_list"><div class="rl_entry"><div class="rl_date"><i class="fa fa-calendar"></i> 10 Nov 2026 <span class="text-muted">19:45</span></div><div class="rl_meta"><div class="rl_venue"><a href="/venues/the-black-lion-1/"><i class="fa fa-beer"></i> The Black Lion<span class="text-muted"> Naphill</span></a></div><div class="rl_loc"><a href="https://maps.google.com/maps?q=51.6707,-0.784933"><i class="fa fa-location-arrow"></i> HP14 4SH</a></div><div class="rl_hares"><i class="fa fa-user"></i> <a href="/hashers/b3x94axni8v/">Zoë</a></div></div></div><div class="rl_entry"><div class="rl_date"><i class="fa fa-calendar"></i> 17 Nov 2026 <span class="text-muted">19:45</span></div><div class="rl_meta"><div class="rl_venue"><a href="/venues/the-king-queen/"><i class="fa fa-beer"></i> The King &amp; Queen<span class="text-muted"> Wendover</span></a></div><div class="rl_loc"><a href="https://maps.google.com/maps?q=51.7605,-0.743484"><i class="fa fa-location-arrow"></i> HP22 6EF</a></div><div class="rl_hares"><i class="fa fa-users"></i> <a href="/hashers/louise/">Just Louise</a> &amp; <a href="/hashers/whipping-boy/">Whipping Boy</a></div></div></div><div class="rl_entry"><div class="rl_date"><i class="fa fa-calendar"></i> 1 Dec 2026 <span class="text-muted">19:45</span></div><div class="rl_meta"><div class="rl_venue"><i class="fa fa-beer"></i> Venue TBA</div><div class="rl_loc"></div><div class="rl_hares"><i class="fa fa-user"></i> <a href="/hashers/hasher-2/">TooKeen</a></div></div></div><div class="rl_entry"><div class="rl_date"><i class="fa fa-calendar"></i> 24 Dec 2026 <span class="text-muted">12:00</span></div><div class="rl_title">It&#039;s Xmas Eve not Xmas Steve.</div><div class="rl_meta"><div class="rl_venue"><a href="/venues/the-keg/"><i class="fa fa-beer"></i> The Keg<span class="text-muted"> Bourne End</span></a></div><div class="rl_loc"><a href="https://maps.google.com/maps?q=51.579545,-0.713822"><i class="fa fa-location-arrow"></i> SL8 5QN</a></div><div class="rl_hares"><i class="fa fa-user"></i> <a href="/hashers/moose/">Moose</a></div></div><div class="rl_extra"><p>Don't forget, we are starting at 12:00</p></div></div></div></div>`;

// Real feed (`curl -s https://www.hwh3.co.uk/hash-cal.ics`, 2026-11-10), trimmed; the
// live file mixes CRLF and LF line endings and double-encodes entities.
const ICS_FIXTURE = [
  "BEGIN:VCALENDAR\r",
  "VERSION:2.0\r",
  "BEGIN:VEVENT\r",
  "UID:HASHID1879",
  "DTSTAMP:20261110T080446",
  "LOCATION: The Black Lion\\, Naphill",
  "DTSTART;TZID=Europe/London:20261110T194500",
  "DTEND;TZID=Europe/London:20261110T214500",
  "SUMMARY:Hash! The Black Lion, Naphill",
  "END:VEVENT\r",
  "BEGIN:VEVENT\r",
  "UID:HASHID1880",
  "LOCATION: The King &amp\\; Queen\\, Wendover",
  "DTSTART;TZID=Europe/London:20261117T194500",
  "END:VEVENT\r",
  "BEGIN:VEVENT\r",
  "UID:HASHID1882",
  "DTSTART;TZID=Europe/London:20261201T194500",
  "END:VEVENT\r",
  "BEGIN:VEVENT\r",
  "UID:HASHID1886",
  "DTSTART;TZID=Europe/London:20261224T120000",
  "END:VEVENT\r",
  "END:VCALENDAR",
].join("\n");

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-hwh3",
    name: "High Wycombe H3 Website",
    url: "https://www.hwh3.co.uk/",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { upcomingOnly: true, icsUrl: "https://www.hwh3.co.uk/hash-cal.ics" },
    ...overrides,
  } as Source;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(body),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

/** Route the two fetches by URL so Promise.all ordering doesn't matter. */
function mockFetches(home: string | Error, ics: string | Error | number) {
  mockedSafeFetch.mockImplementation(async (url: string) => {
    const body = url.endsWith(".ics") ? ics : home;
    if (body instanceof Error) throw body;
    if (typeof body === "number") return textResponse("", body);
    return textResponse(body);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockedSafeFetch.mockReset();
});

describe("parseHwh3Date", () => {
  it("parses the run-list date", () => {
    expect(parseHwh3Date("10 Nov 2026")).toBe("2026-11-10");
    expect(parseHwh3Date(" 1 Dec 2026 ")).toBe("2026-12-01");
  });
  it("rejects garbage and impossible dates", () => {
    expect(parseHwh3Date("Venue TBA")).toBeNull();
    expect(parseHwh3Date("31 Feb 2026")).toBeNull();
    expect(parseHwh3Date("10 Foo 2026")).toBeNull();
  });
});

describe("normalizeUkPostcode", () => {
  it("inserts the inward-code space and uppercases", () => {
    expect(normalizeUkPostcode("SL71QU")).toBe("SL7 1QU");
    expect(normalizeUkPostcode(" hp14 4sh ")).toBe("HP14 4SH");
  });
  it("rejects non-postcodes", () => {
    expect(normalizeUkPostcode("")).toBeUndefined();
    expect(normalizeUkPostcode("Naphill")).toBeUndefined();
  });
});

describe("parseHwh3RunNumbers", () => {
  it("maps local start dates to HASHID run numbers across mixed line endings", () => {
    const map = parseHwh3RunNumbers(ICS_FIXTURE);
    expect(map.get("2026-11-10")).toBe(1879);
    expect(map.get("2026-11-17")).toBe(1880);
    expect(map.get("2026-12-24")).toBe(1886);
    expect(map.size).toBe(4);
  });
  it("skips events missing a UID or DTSTART", () => {
    expect(parseHwh3RunNumbers("BEGIN:VEVENT\nUID:other\nDTSTART:20261110T194500\nEND:VEVENT").size).toBe(0);
  });
});

describe("parseHwh3Entry", () => {
  const $ = cheerio.load(HOME_FIXTURE);
  const entries = $(".rl_entry").toArray();
  const runNumbers = parseHwh3RunNumbers(ICS_FIXTURE);

  it("parses a normal run with venue, postcode, pin and run number", () => {
    expect(parseHwh3Entry($, entries[0], runNumbers)).toEqual({
      date: "2026-11-10",
      kennelTags: ["hwh3"],
      runNumber: 1879,
      title: undefined,
      startTime: "19:45",
      location: "The Black Lion, Naphill",
      locationStreet: "HP14 4SH",
      locationUrl: "https://maps.google.com/maps?q=51.6707,-0.784933",
      latitude: 51.6707,
      longitude: -0.784933,
      hares: "Zoë",
      description: null,
      sourceUrl: "https://www.hwh3.co.uk/",
    });
  });

  it("decodes &amp; and sorts multiple hares", () => {
    const event = parseHwh3Entry($, entries[1], runNumbers);
    expect(event?.location).toBe("The King & Queen, Wendover");
    expect(event?.hares).toBe("Just Louise, Whipping Boy");
  });

  it("clears venue, postcode and pin on a Venue TBA row", () => {
    const event = parseHwh3Entry($, entries[2], runNumbers);
    expect(event).toMatchObject({
      date: "2026-12-01",
      runNumber: 1882,
      location: null,
      locationStreet: null,
      dropCachedCoords: true,
      hares: "TooKeen",
    });
    expect(event?.latitude).toBeUndefined();
    expect(event?.locationUrl).toBeUndefined();
  });

  it("reads the theme title, note and midday start on the Xmas Eve run", () => {
    const event = parseHwh3Entry($, entries[3], runNumbers);
    expect(event).toMatchObject({
      date: "2026-12-24",
      runNumber: 1886,
      title: "It's Xmas Eve not Xmas Steve.",
      startTime: "12:00",
      location: "The Keg, Bourne End",
      locationStreet: "SL8 5QN",
      description: "Don't forget, we are starting at 12:00",
    });
  });

  it("clears hares when the cell has no hare", () => {
    const $tba = cheerio.load(HOME_FIXTURE.replace('<a href="/hashers/hasher-2/">TooKeen</a>', "TBA"));
    expect(parseHwh3Entry($tba, $tba(".rl_entry").toArray()[2])?.hares).toBeNull();
  });

  it("leaves runNumber unset when the ICS has no match", () => {
    expect(parseHwh3Entry($, entries[0])?.runNumber).toBeUndefined();
  });
});

describe("HighWycombeHashAdapter.fetch", () => {
  it("returns runs joined to ICS run numbers", async () => {
    mockFetches(HOME_FIXTURE, ICS_FIXTURE);
    const result = await new HighWycombeHashAdapter().fetch(makeSource(), { days: 100_000 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => [e.date, e.runNumber])).toEqual([
      ["2026-11-10", 1879],
      ["2026-11-17", 1880],
      ["2026-12-01", 1882],
      ["2026-12-24", 1886],
    ]);
    expect(result.diagnosticContext).toMatchObject({ entriesParsed: 4, icsRunNumbers: 4, runNumbersMatched: 4 });
  });

  it("keeps the runs when the ICS fails, recording it as a diagnostic", async () => {
    mockFetches(HOME_FIXTURE, 500);
    const result = await new HighWycombeHashAdapter().fetch(makeSource(), { days: 100_000 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
    expect(result.events.every((e) => e.runNumber === undefined)).toBe(true);
    expect(result.diagnosticContext).toMatchObject({ icsError: "ICS HTTP 500" });
  });

  it("survives a thrown ICS fetch", async () => {
    mockFetches(HOME_FIXTURE, new Error("socket hang up"));
    const result = await new HighWycombeHashAdapter().fetch(makeSource(), { days: 100_000 });
    expect(result.events).toHaveLength(4);
    expect(String(result.diagnosticContext?.icsError)).toContain("socket hang up");
  });

  it("fails loud when the runs list is missing", async () => {
    mockFetches("<html><body><div class='card'>Site rebuilt</div></body></html>", ICS_FIXTURE);
    const result = await new HighWycombeHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("0 runs parsed");
  });

  it("returns the fetch error when the home page fails", async () => {
    mockFetches(new Error("ECONNRESET"), ICS_FIXTURE);
    const result = await new HighWycombeHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("ECONNRESET");
  });

  it("drops runs outside the date window", async () => {
    mockFetches(HOME_FIXTURE, ICS_FIXTURE);
    const result = await new HighWycombeHashAdapter().fetch(makeSource(), { days: 0 });
    expect(result.events).toEqual([]);
    expect(result.diagnosticContext).toMatchObject({ entriesParsed: 4, eventsInWindow: 0 });
  });
});
