import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { MkH3Adapter, parseMkDateLine, parseMkRunsEvents, splitMkVenue } from "./mkh3";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-mkh3") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Real concrete5 widgets (curl'd 2026-11-05 from mkh3.co.uk/runs-events):
// "Forthcoming Runs" — #1940 (venue "Hares Required" placeholder) and a
// "No Run" block; "Forthcoming Events" — #1941 "Arseover's 1000th - TBA".
const PAGE_HTML = readFileSync(path.join(__dirname, "fixtures/mkh3-runs-events-2026-11-05.html.fixture"), "utf8");

function makeSource(): Source {
  return {
    id: "src-mkh3",
    name: "MKH3 Website",
    url: "https://mkh3.co.uk/runs-events",
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

describe("MKH3 helpers", () => {
  it("parses the full date line with start and end times", () => {
    expect(parseMkDateLine("Nov 9, 2026, 6:50 PM – 9:00 PM")).toEqual({
      date: "2026-11-09", startTime: "18:50", endTime: "21:00",
    });
    expect(parseMkDateLine("Aug 31, 2026, 11:00 AM – 2:00 PM")).toEqual({
      date: "2026-08-31", startTime: "11:00", endTime: "14:00",
    });
    expect(parseMkDateLine("Feb 30, 2026, 7:00 PM")).toBeNull();
  });

  it("splits venue and postcode; drops placeholders", () => {
    expect(splitMkVenue("Cannon, Newport Pagnell - MK16 8AQ")).toEqual({
      location: "Cannon, Newport Pagnell", locationStreet: "MK16 8AQ",
    });
    expect(splitMkVenue("Hares Required")).toEqual({});
    expect(splitMkVenue("Cross Keys, Woolstone")).toEqual({ location: "Cross Keys, Woolstone" });
  });
});

describe("parseMkRunsEvents", () => {
  it("parses both real widgets, skipping No Run and recruiting boilerplate", () => {
    const events = parseMkRunsEvents(PAGE_HTML);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      date: "2026-11-09",
      kennelTags: ["mkh3"],
      runNumber: 1940,
      startTime: "18:50",
      endTime: "21:00",
      location: undefined,
      description: "Meet in pub from 18:50. The 19:00 run start time is approximate.",
    });
    expect(events[0].title).toBeUndefined();
    expect(events[1]).toMatchObject({
      date: "2026-11-21",
      runNumber: 1941,
      title: "Arseover's 1000th",
      startTime: "11:00",
      endTime: "16:00",
      location: undefined,
      description: "Arseover Tit 1000th Run\nVenue TBA",
    });
  });

  it("reads hares and the venue line on a regular run", () => {
    const html = `<div class="ccm-block-calendar-event-list-wrapper"><h2>Forthcoming Runs</h2>
      <div class="ccm-block-calendar-event-list-event">
        <div class="ccm-block-calendar-event-list-event-title">Cannon, Newport Pagnell - MK16 8AQ</div>
        <div class="ccm-block-calendar-event-list-event-date-full">Aug 17, 2026, 6:50 PM – 9:00 PM</div>
        <div class="ccm-block-calendar-event-list-event-description"><p>Run: 1931</p><p>Hares: Nice Flaps, Rubber Jonny</p></div>
      </div></div>`;
    expect(parseMkRunsEvents(html)[0]).toMatchObject({
      runNumber: 1931, hares: "Nice Flaps, Rubber Jonny", location: "Cannon, Newport Pagnell", locationStreet: "MK16 8AQ",
    });
  });
});

describe("MkH3Adapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns windowed events from the live page", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse(PAGE_HTML));
    const result = await new MkH3Adapter().fetch(makeSource(), { days: 90 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(2);
  });

  it("fails loud when no calendar blocks exist", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse("<html><body><h2>Runs</h2></body></html>"));
    const result = await new MkH3Adapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/no calendar event blocks/);
  });
});
