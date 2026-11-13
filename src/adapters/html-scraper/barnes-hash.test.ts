import { safeFetch } from "@/adapters/safe-fetch";
import { BarnesHashAdapter, findSheetUrls, parseBarnesRuns, parseBarnesVenues } from "./barnes-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
const mockSafeFetch = vi.mocked(safeFetch);

const RUNS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=0&single=true&output=csv";
const VENUES_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=762376039&single=true&output=csv";

// Trimmed from barnesh3.com/config.js (2026-11-12).
const CONFIG_JS = `window.HARELINE_CONFIG = {
  runsCsvUrl: "${RUNS_URL}",
  venuesCsvUrl: "${VENUES_URL}",
  hareRequestsCsvUrl: "",
  defaultStart: "19:30"
};
Object.assign(window.HARELINE_CONFIG, { fallbackRunsUrl: "/data/runs.csv" });`;

// Trimmed from the published runs sheet (2026-11-12).
const RUNS_CSV = `Run,Date,Venue,Hares,Start,Notes
2144,04/11/2026,"The Griffin, Claygate","Contour, Last Tango",,
2145,11/11/2026,"Upper West Street Car Park, Reigate",OITE,,"Run is from the car park,
On inn: Pilgrim Brewery RH2 9BL"
2147,25/11/2026,Ye Old Ship Inn,Specky & Le Pro,19:00,
2150,16/12/2026,TBA,Scargill,,Christmas lights run!
2151,23/12/2026,,Hare Wanted,,
2152,30/12/2026,,,,
,,,,,
`;

const VENUES_CSV = `Venue,Address,Postcode,Website,Phone,Notes
"The Griffin, Claygate",Common Road,KT10 0HW,,,
Ye Old Ship Inn,"Portsmouth Rd, Guildford",GU2 4EB,,,"Park at the back.
What3words: ///a.b.c"
`;

describe("findSheetUrls", () => {
  it("reads the runs and venues CSV links from config.js", () => {
    expect(findSheetUrls(CONFIG_JS)).toEqual({ runsCsvUrl: RUNS_URL, venuesCsvUrl: VENUES_URL });
  });

  it("lets a later Object.assign override win, like the site's own config", () => {
    const overridden = `${CONFIG_JS}\nObject.assign(window.HARELINE_CONFIG, { runsCsvUrl: "https://docs.google.com/new.csv" });`;
    expect(findSheetUrls(overridden).runsCsvUrl).toBe("https://docs.google.com/new.csv");
  });

  it("ignores blank or non-https links", () => {
    expect(findSheetUrls(`runsCsvUrl: "", venuesCsvUrl: "/data/venues.csv"`)).toEqual({
      runsCsvUrl: undefined,
      venuesCsvUrl: undefined,
    });
  });
});

describe("parseBarnesRuns", () => {
  const events = parseBarnesRuns(RUNS_CSV, parseBarnesVenues(VENUES_CSV), "https://barnesh3.com/hareline/");
  const byRun = (n: number) => events.find((e) => e.runNumber === n);

  it("parses every dated row, UK day-first", () => {
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [2144, "2026-11-04"],
      [2145, "2026-11-11"],
      [2147, "2026-11-25"],
      [2150, "2026-12-16"],
      [2151, "2026-12-23"],
      [2152, "2026-12-30"],
    ]);
  });

  it("joins the venue's street address and builds a maps link", () => {
    expect(byRun(2144)).toMatchObject({
      kennelTags: ["barnesh3"],
      title: "Barnes Hash Run #2144",
      location: "The Griffin, Claygate",
      locationStreet: "Common Road, KT10 0HW",
      locationUrl: "https://www.google.com/maps/search/?api=1&query=The%20Griffin%2C%20Claygate%2C%20Common%20Road%2C%20KT10%200HW",
      startTime: "19:30",
      sourceUrl: "https://barnesh3.com/hareline/",
    });
  });

  it("leaves the street empty for a venue missing from the venues sheet", () => {
    expect(byRun(2145)?.location).toBe("Upper West Street Car Park, Reigate");
    expect(byRun(2145)?.locationStreet).toBeUndefined();
    expect(byRun(2145)?.locationUrl).toBeUndefined();
    expect(byRun(2145)?.description).toBe("Run is from the car park, On inn: Pilgrim Brewery RH2 9BL");
  });

  it("splits and sorts hares, and reads an explicit start time", () => {
    expect(byRun(2144)?.hares).toBe("Contour, Last Tango");
    expect(byRun(2147)).toMatchObject({ hares: "Le Pro, Specky", startTime: "19:00", locationStreet: "Portsmouth Rd, Guildford, GU2 4EB" });
  });

  it("clears a TBA venue and a 'Hare Wanted' hare, and leaves blank cells unknown", () => {
    expect(byRun(2150)?.location).toBeNull();
    expect(byRun(2150)?.locationStreet).toBeNull();
    expect(byRun(2151)?.location).toBeUndefined();
    expect(byRun(2150)?.description).toBe("Christmas lights run!");
    expect(byRun(2151)?.hares).toBeNull();
    expect(byRun(2152)?.hares).toBeUndefined();
  });
});

describe("BarnesHashAdapter.fetch", () => {
  const source = { id: "s", url: "https://barnesh3.com/hareline/", scrapeDays: 3650 } as never;
  const ok = (body: string) => new Response(body, { status: 200 });

  beforeEach(() => mockSafeFetch.mockReset());

  it("reads config.js, then the runs and venues sheets", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(ok(CONFIG_JS))
      .mockResolvedValueOnce(ok(RUNS_CSV))
      .mockResolvedValueOnce(ok(VENUES_CSV));
    const result = await new BarnesHashAdapter().fetch(source);
    expect(mockSafeFetch.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://barnesh3.com/config.js",
      RUNS_URL,
      VENUES_URL,
    ]);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(6);
    expect(result.events[0].locationStreet).toBe("Common Road, KT10 0HW");
  });

  it("still returns runs when the venues sheet fails", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(ok(CONFIG_JS))
      .mockResolvedValueOnce(ok(RUNS_CSV))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const result = await new BarnesHashAdapter().fetch(source);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(6);
    expect(result.events[0].locationStreet).toBeUndefined();
    expect(result.diagnosticContext?.venuesError).toContain("HTTP 500");
  });

  it("fails loud when config.js no longer names the runs sheet", async () => {
    mockSafeFetch.mockResolvedValueOnce(ok(`window.HARELINE_CONFIG = { runsCsvUrl: "" };`));
    const result = await new BarnesHashAdapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("runsCsvUrl not found");
  });

  it("fails loud when the runs sheet has no parseable rows", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(ok(CONFIG_JS))
      .mockResolvedValueOnce(ok("<html>Sign in</html>"))
      .mockResolvedValueOnce(ok(VENUES_CSV));
    const result = await new BarnesHashAdapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("0 runs parsed");
  });
});

describe("BarnesHashAdapter.fetch — pinned sheet URLs", () => {
  beforeEach(() => mockSafeFetch.mockReset());

  it("skips config.js when source.config pins the sheet URLs", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(new Response(RUNS_CSV, { status: 200 }))
      .mockResolvedValueOnce(new Response(VENUES_CSV, { status: 200 }));
    const source = {
      id: "s",
      url: "https://barnesh3.com/hareline/",
      scrapeDays: 3650,
      config: { runsCsvUrl: RUNS_URL, venuesCsvUrl: VENUES_URL },
    } as never;
    const result = await new BarnesHashAdapter().fetch(source);
    expect(mockSafeFetch.mock.calls.map((c) => String(c[0]))).toEqual([RUNS_URL, VENUES_URL]);
    expect(result.events).toHaveLength(6);
  });
});
