import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { CambridgeHashAdapter, coordsFromDestination, parseCambridgeRunList, splitVenue } from "./cambridge-hash";

vi.mock("@/lib/browser-render", () => ({ browserRender: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-cambridge") }));

const { browserRender } = await import("@/lib/browser-render");
const mockedRender = vi.mocked(browserRender);

// Real browser-rendered .RunList (NAS browserRender of https://www.ch3.co.uk/,
// 2026-11-05), trimmed to the "November 2026" header, runs #2500 and #2498
// (class nextRun), the "October 2026" header and run #2496.
const RENDERED_HTML = readFileSync(
  path.join(__dirname, "fixtures/cambridge-runlist-rendered-2026-11-05.html.fixture"),
  "utf8",
);

function makeSource(): Source {
  return {
    id: "src-cambridge",
    name: "Cambridge H3 Website",
    url: "https://www.ch3.co.uk/",
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true },
    scrapeDays: 90,
  } as unknown as Source;
}

describe("Cambridge helpers", () => {
  it("splits venue/town/postcode and drops the phone suffix", () => {
    expect(splitVenue("- Hoops , Barton, CB23 7BD - Tel: 01223 344 995")).toEqual({
      location: "Hoops",
      locationStreet: "Barton, CB23 7BD",
    });
  });
  it("drops the TBD / Anywhere / CB1 2JW placeholder venue", () => {
    expect(splitVenue("TBD , Anywhere, CB1 2JW")).toEqual({});
  });
  it("reads coordinates from a Maps directions link", () => {
    expect(coordsFromDestination("https://www.google.com/maps/dir/?api=1&destination=52.182344,0.056850")).toEqual({
      latitude: 52.182344,
      longitude: 0.05685,
    });
    expect(coordsFromDestination("not a url")).toBeUndefined();
    expect(coordsFromDestination(undefined)).toBeUndefined();
  });
});

describe("parseCambridgeRunList", () => {
  it("parses the real rendered run list with years from the month headers", () => {
    const events = parseCambridgeRunList(RENDERED_HTML);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [2500, "2026-11-22"],
      [2498, "2026-11-08"],
      [2496, "2026-10-25"],
    ]);
    expect(events[0]).toMatchObject({
      kennelTags: ["cambridge-h3"],
      startTime: "11:00",
      location: "Hoops",
      locationStreet: "Barton, CB23 7BD",
      latitude: 52.182344,
      longitude: 0.05685,
      hares: "Jetstream and Unmentionable",
    });
    expect(events[0].title).toBeUndefined();
    expect(events[0].description).toMatch(/^Back to the venue of the very first Cambridge Hash Run/);
    expect(JSON.stringify(events)).not.toMatch(/Tel:|01223 344 995/);
  });

  it("assigns a December run under a January header to the previous year", () => {
    const html = `<div class="RunList"><h3>January 2027</h3>
      <div><span link>Run 2506 Dec 27th</span> - TBD , Anywhere, CB1 2JW<br>Hare: <span>Wrong Way</span></div></div>`;
    expect(parseCambridgeRunList(html)[0]).toMatchObject({ date: "2026-12-27", location: undefined, latitude: undefined });
  });
});

describe("CambridgeHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("renders with the Blazor wait selector and London timezone", async () => {
    mockedRender.mockResolvedValue(RENDERED_HTML);
    const result = await new CambridgeHashAdapter().fetch(makeSource(), { days: 90 });
    expect(mockedRender).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.ch3.co.uk/", waitFor: ".RunList", timezoneId: "Europe/London" }),
    );
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(3);
  });

  it("fails loud when the render has no runs", async () => {
    mockedRender.mockResolvedValue("<html><body><div class='RunList'></div></body></html>");
    const result = await new CambridgeHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/0 runs parsed/);
  });

  it("reports a render failure as a fetch error", async () => {
    mockedRender.mockRejectedValue(new Error("timeout"));
    const result = await new CambridgeHashAdapter().fetch(makeSource());
    expect(result.errors[0]).toMatch(/Browser render failed/);
  });
});
