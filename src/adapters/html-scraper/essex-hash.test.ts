import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { EssexHashAdapter, parseEssexHareline, parseEssexHeading, parseEssexTime } from "./essex-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-essex") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Real GoDaddy calendar markup (curl'd 2026-11-05 from essexhhh.co.uk/hareline):
// runs #2169 and #2172, each in BOTH the SMALLER (mobile) and BIGGER (desktop)
// screen containers — the adapter must read one and not double-emit.
const HARELINE_HTML = readFileSync(path.join(__dirname, "fixtures/essex-hareline-2026-11-05.html.fixture"), "utf8");

function makeSource(): Source {
  return {
    id: "src-essex",
    name: "Essex H3 Website Hareline",
    url: "https://essexhhh.co.uk/hareline",
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true },
    scrapeDays: 90,
  } as unknown as Source;
}

function htmlResponse(html: string): Response {
  return {
    ok: true, status: 200, statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

describe("Essex parsing helpers", () => {
  it("parses ordinal-dated headings with run numbers", () => {
    expect(parseEssexHeading("Monday 9th November 2026 - Run 2169")).toEqual({ date: "2026-11-09", runNumber: 2169 });
    expect(parseEssexHeading("TUESDAY 17th November 2026 - Run 2170")).toEqual({ date: "2026-11-17", runNumber: 2170 });
    expect(parseEssexHeading("Sunday 31st November 2026 - Run 1")).toBeNull();
    expect(parseEssexHeading("Coming soon")).toBeNull();
  });

  it("parses am/pm times", () => {
    expect(parseEssexTime("7pm")).toBe("19:00");
    expect(parseEssexTime("11am")).toBe("11:00");
    expect(parseEssexTime("12pm")).toBe("12:00");
    expect(parseEssexTime("7:30 pm")).toBe("19:30");
    expect(parseEssexTime("TBC")).toBeUndefined();
  });
});

describe("parseEssexHareline", () => {
  it("reads only the desktop container and maps the real card fields", () => {
    const events = parseEssexHareline(HARELINE_HTML);
    expect(events.map((e) => e.runNumber)).toEqual([2169, 2172]);
    expect(events[0]).toMatchObject({
      date: "2026-11-09",
      kennelTags: ["essex-h3"],
      startTime: "19:00",
      location: "The Benfleet Tavern, Richmond Avenue, Benfleet, SS7 5HF",
      description: undefined,
    });
    expect(events[0].locationUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/place\/The\+Benfleet\+Tavern/);
    expect(events[0].title).toBeUndefined();
    expect(events[1].description).toBe("There;ll be no food afterwards");
  });

  it("extracts a 'Hares - X & Y' line from the description", () => {
    const html = `<div data-aid="CALENDAR_BIGGER_SCREEN_CONTAINER">
      <h4 data-aid="CALENDAR_EVENT_DATE">Monday 24th August 2026 - Run 2157</h4>
      <p data-aid="CALENDAR_EVENT_TITLE">67 Kitkatts Road, Canvey Island, SS8 0DY</p>
      <div data-aid="CALENDAR_DESC_TEXT"><p><a href="https://www.google.com/maps/place/x/@1,2">Map</a></p><p>Hares - Zipper &amp; Frogman</p><p>Beer Festival</p></div>
      <p data-aid="CALENDAR_EVENT_TIME">7pm</p></div>`;
    expect(parseEssexHareline(html)[0]).toMatchObject({ hares: "Zipper & Frogman", description: "Beer Festival" });
  });
});

describe("EssexHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns the windowed runs", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse(HARELINE_HTML));
    const result = await new EssexHashAdapter().fetch(makeSource(), { days: 90 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(2);
  });

  it("fails loud on zero runs", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse("<html><body>No events</body></html>"));
    const result = await new EssexHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/0 runs parsed/);
  });
});
