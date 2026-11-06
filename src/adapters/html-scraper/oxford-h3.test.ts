import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { OxfordH3Adapter, oxfordHeaderKey, parseOxfordDate, parseOxfordRow, parseOxfordTables } from "./oxford-h3";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-oxford") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Real igsv (Inline Google Spreadsheet Viewer) tables, curl'd 2026-11-05:
// homepage Hash Diary — #1370, #1372 (hare only), "Christmas Dinner" (unnumbered
// social), Plough (unnumbered, with postcode), Burns Night, and a blank skeleton
// row; archive /run-list-3-2/ — #875 and #876 ("30/9/15 19:00" two-digit years).
const DIARY_HTML = readFileSync(path.join(__dirname, "fixtures/oxford-hash-diary-2026-11-05.html.fixture"), "utf8");
const ARCHIVE_HTML = readFileSync(path.join(__dirname, "fixtures/oxford-run-list-2015-2026-11-05.html.fixture"), "utf8");

function makeSource(): Source {
  return {
    id: "src-oxford",
    name: "Oxford H3 Website",
    url: "https://www.oxfordh3.org.uk/",
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true },
    scrapeDays: 180,
  } as unknown as Source;
}

function htmlResponse(html: string): Response {
  return {
    ok: true, status: 200, statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

describe("Oxford helpers", () => {
  it("parses four-digit, two-digit and seconds-bearing dates", () => {
    expect(parseOxfordDate("04/11/2026 19:00")).toEqual({ date: "2026-11-04", startTime: "19:00" });
    expect(parseOxfordDate("30/9/15 19:00")).toEqual({ date: "2015-09-30", startTime: "19:00" });
    expect(parseOxfordDate("30/09/2026 19:00:00")).toEqual({ date: "2026-09-30", startTime: "19:00" });
    expect(parseOxfordDate("Sat 09/09/17 13:00")).toBeNull();
    expect(parseOxfordDate("31/02/2027 19:00")).toBeNull();
  });

  it("maps header labels", () => {
    expect(["Date", "Post Code", "Venue", "Hares", "Map Link", "Run#", "Chef"].map(oxfordHeaderKey)).toEqual([
      "date", "postcode", "venue", "hares", "map", "run", undefined,
    ]);
  });

  it("drops NO HASH rows and keeps only Maps URLs from the Map Link cell", () => {
    expect(parseOxfordRow({ date: "25/12/2019 19:00", venue: "NO HASH" })).toBeNull();
    expect(parseOxfordRow({ date: "04/11/2026 19:00", venue: "Pub, Town", map: "The Pub", run: "1" })?.locationUrl).toBeUndefined();
    expect(parseOxfordRow({ date: "04/11/2026 19:00", venue: "Pub, Town", map: "https://goo.gl/maps/LVU42", run: "1" })?.locationUrl)
      .toBe("https://goo.gl/maps/LVU42");
  });
});

describe("parseOxfordTables", () => {
  it("parses the real Hash Diary, skipping blank skeleton rows", () => {
    const events = parseOxfordTables(DIARY_HTML);
    expect(events.map((e) => e.date)).toEqual(["2026-11-04", "2026-12-02", "2026-12-16", "2027-01-06", "2027-01-20"]);
    expect(events[0]).toMatchObject({
      kennelTags: ["oxford-h3"],
      runNumber: 1370,
      startTime: "19:00",
      location: "Three Pigeons, Witney",
      locationStreet: "OX28 1DG",
      hares: "Richard D'Turd",
    });
    expect(events[0].title).toBeUndefined();
    expect(events[1]).toMatchObject({ runNumber: 1372, location: undefined, hares: "Cruella" });
    expect(events[2]).toMatchObject({ runNumber: undefined, title: "Christmas Dinner", location: undefined });
    expect(events[3]).toMatchObject({ title: undefined, location: "Plough, Wolvercote", locationStreet: "OX2 8BD" });
  });

  it("parses archive rows with two-digit years", () => {
    const events = parseOxfordTables(ARCHIVE_HTML);
    expect(events[0]).toMatchObject({ runNumber: 875, date: "2015-09-30", locationUrl: "https://goo.gl/maps/LVU42" });
  });
});

describe("OxfordH3Adapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns windowed diary rows", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse(DIARY_HTML));
    const result = await new OxfordH3Adapter().fetch(makeSource(), { days: 180 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(5);
  });

  it("fails loud when the table yields nothing", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse("<html><body><p>Site maintenance</p></body></html>"));
    const result = await new OxfordH3Adapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/0 rows parsed/);
  });
});
