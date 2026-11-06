import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { WarwickHashAdapter, closestYear, parseWarwickCaption } from "./warwick-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-warwick") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Real homepage hero block (curl'd 2026-11-05 from warwickhash.org.uk).
const HOME_HTML = readFileSync(path.join(__dirname, "fixtures/warwick-home-2026-11-05.html.fixture"), "utf8");
const NOW = new Date("2026-11-05T12:00:00Z");

function makeSource(): Source {
  return {
    id: "src-warwick",
    name: "Warwick H3 Website",
    url: "https://www.warwickhash.org.uk/",
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

describe("closestYear", () => {
  it("picks the year nearest to now", () => {
    expect(closestYear(11, 2, NOW)).toBe(2026);
    expect(closestYear(1, 4, new Date("2026-12-30T12:00:00Z"))).toBe(2027);
    expect(closestYear(12, 28, new Date("2027-01-03T12:00:00Z"))).toBe(2026);
  });
});

describe("parseWarwickCaption", () => {
  const links = [
    { text: "The Black Pug", href: "https://theblackpug.pub/" },
    { text: "CV34 4NU", href: "https://maps.app.goo.gl/g3X7723P9Rjep8H17" },
  ];
  it("parses the live caption shape", () => {
    const e = parseWarwickCaption(
      "Next Run (#664): Monday, November 2nd at 7:00pm from The Black Pug, Warwick, CV34 4NU",
      links,
      NOW,
    );
    expect(e).toMatchObject({
      date: "2026-11-02",
      kennelTags: ["warwick-h3"],
      runNumber: 664,
      startTime: "19:00",
      location: "The Black Pug",
      locationStreet: "Warwick, CV34 4NU",
      locationUrl: "https://maps.app.goo.gl/g3X7723P9Rjep8H17",
    });
    expect(e?.title).toBeUndefined();
  });
  it("returns null for a caption without a run", () => {
    expect(parseWarwickCaption("Bringing the hash to Warwick", [], NOW)).toBeNull();
  });
});

describe("WarwickHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("emits the single next run from the real hero block", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse(HOME_HTML));
    const result = await new WarwickHashAdapter().fetch(makeSource());
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ runNumber: 664, date: "2026-11-02", location: "The Black Pug" });
  });

  it("fails loud when the caption is missing", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse("<html><body><h1>Warwick</h1></body></html>"));
    const result = await new WarwickHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/no 'Next Run/);
  });
});
