import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { QuornH3Adapter, parseQuornRunlog, runlogUrl } from "./quorn-h3";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-quorn") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Real <run> blocks copied verbatim (2026-11-05) from quornh3.org.uk:
// runlog2026.xml #1144-#1146 (#1145 has "tba" venue + boilerplate <info>), and
// a mixed-era file: runlog2014.xml #819 (unpadded date/month, "_" info) plus
// runlog2025.xml's "0000" ***CANCELLED*** placeholder.
const XML_2026 = readFileSync(path.join(__dirname, "fixtures/quorn-runlog-2026-11-05.xml.fixture"), "utf8");
const XML_MIXED = readFileSync(
  path.join(__dirname, "fixtures/quorn-runlog-mixed-eras-2026-11-05.xml.fixture"),
  "utf8",
);
const BASE = "https://www.quornh3.org.uk/runlog.html";

function makeSource(): Source {
  return {
    id: "src-quorn",
    name: "Quorn H3 Runlog XML",
    url: BASE,
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true },
    scrapeDays: 365,
  } as unknown as Source;
}

function xmlResponse(body: string): Response {
  return {
    ok: true, status: 200, statusText: "OK",
    text: () => Promise.resolve(body),
    headers: new Headers({ "content-type": "text/xml" }),
  } as Response;
}
const NOT_FOUND = { ok: false, status: 404, statusText: "Not Found" } as Response;

describe("runlogUrl", () => {
  it("builds the per-year XML URL on the source origin", () => {
    expect(runlogUrl(BASE, 2027)).toBe("https://www.quornh3.org.uk/runlog2027.xml");
  });
});

describe("parseQuornRunlog", () => {
  it("parses real 2026 runs, clearing tba/boilerplate values", () => {
    const events = parseQuornRunlog(XML_2026, "u");
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [1144, "2026-11-01"],
      [1145, "2026-12-06"],
      [1146, "2026-12-20"],
    ]);
    expect(events[0]).toMatchObject({
      kennelTags: ["quorn-h3"],
      startTime: "11:00",
      hares: "Barritone",
      location: "Admiral Rodney",
      locationStreet: "Wollaton, Nottingham, NG8 2AF",
    });
    expect(events[0].title).toBeUndefined();
    expect(events[1]).toMatchObject({ location: undefined, description: undefined });
    expect(events[2]).toMatchObject({ location: "Nottingham", description: "Jingle Balls Run and Pub Crawl" });
  });

  it("handles unpadded 2014 dates, '_' info and skips 0000 cancelled placeholders", () => {
    const events = parseQuornRunlog(XML_MIXED, "u");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runNumber: 819, date: "2014-01-05", description: undefined });
  });
});

describe("QuornH3Adapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("reads the current-year file and tolerates an unpublished next-year file", async () => {
    mockedSafeFetch.mockImplementation(async (url) => (String(url).endsWith("runlog2026.xml") ? xmlResponse(XML_2026) : NOT_FOUND));
    const result = await new QuornH3Adapter().fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(3);
    expect(result.diagnosticContext?.nextYearFile).toBe("not published");
  });

  it("falls back to last year's file when the current year 404s", async () => {
    vi.setSystemTime(new Date("2027-01-02T12:00:00Z"));
    mockedSafeFetch.mockImplementation(async (url) => (String(url).endsWith("runlog2026.xml") ? xmlResponse(XML_2026) : NOT_FOUND));
    const result = await new QuornH3Adapter().fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([1144, 1145, 1146]);
  });

  it("fails loud when the file has no runs", async () => {
    mockedSafeFetch.mockImplementation(async (url) =>
      String(url).endsWith("runlog2026.xml") ? xmlResponse("<runlog></runlog>") : NOT_FOUND,
    );
    const result = await new QuornH3Adapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/0 runs parsed/);
  });
});
