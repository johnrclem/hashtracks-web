import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import {
  SurreyHashAdapter,
  buildSurreyEvent,
  inferYear,
  parseSurreyDetail,
  parseSurreyGridRow,
} from "./surrey-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-surrey") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Trimmed real-page fixtures (curl'd 2026-11-05 from surreyhashhouseharriers.com):
// the header section plus runs #2650 (linked), #2653 (location "TBC"), a run-less
// bonus trail on 01 January 2027, #2658 (year-bearing, linked) and #2659 (no link).
const HARELINE_HTML = readFileSync(
  path.join(__dirname, "fixtures/surrey-receding-hareline-2026-11-05.html.fixture"),
  "utf8",
);
const DETAIL_2650_HTML = readFileSync(
  path.join(__dirname, "fixtures/surrey-trail-2650-2026-11-05.html.fixture"),
  "utf8",
);

const NOW = new Date("2026-11-05T12:00:00Z");

function makeSource(): Source {
  return {
    id: "src-surrey",
    name: "Surrey H3 Website Hareline",
    url: "https://surreyhashhouseharriers.com/receding-hareline/",
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true },
    scrapeDays: 120,
  } as unknown as Source;
}

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

describe("inferYear", () => {
  it("keeps the current year for near-term and slightly-past dates", () => {
    expect(inferYear(11, 8, NOW)).toBe(2026);
    expect(inferYear(11, 1, NOW)).toBe(2026);
  });
  it("rolls to next year once the current-year date is >6 months past", () => {
    expect(inferYear(1, 3, NOW)).toBe(2027);
  });
});

describe("parseSurreyGridRow", () => {
  it("parses a year-less current-year row", () => {
    expect(parseSurreyGridRow(["2650 08 November", "Tiller", "Donkey Town"], "u", NOW)).toEqual({
      runNumber: 2650,
      date: "2026-11-08",
      hares: "Tiller",
      location: "Donkey Town",
      detailUrl: "u",
    });
  });
  it("uses an explicit year and treats TBC as undefined", () => {
    const row = parseSurreyGridRow(["2658 03 January 2027", "Dr Death", "TBC"], undefined, NOW);
    expect(row).toMatchObject({ runNumber: 2658, date: "2027-01-03", location: undefined });
  });
  it("accepts a run-less bonus row", () => {
    const row = parseSurreyGridRow(["01 January 2027", "Bonus trail", "Guildford"], undefined, NOW);
    expect(row).toMatchObject({ runNumber: undefined, date: "2027-01-01" });
  });
  it("rejects the header row and invalid dates", () => {
    expect(parseSurreyGridRow(["Run no. / Date", "Hare(s)", "Location"], undefined, NOW)).toBeNull();
    expect(parseSurreyGridRow(["2650 31 November", "x", "y"], undefined, NOW)).toBeNull();
  });
});

describe("parseSurreyDetail", () => {
  it("reads the Elementor label/value pairs from a real trail page", () => {
    const d = parseSurreyDetail(DETAIL_2650_HTML);
    expect(d.runNumber).toBe(2650);
    expect(d.date).toBe("2026-11-08");
    expect(d.hares).toBe("Yellow Peril & Hanging About (joint with NH4)");
    expect(d.from).toBe("Brentmoor Rd, West End, Woking GU24 9QG");
    expect(d.onOn).toBe("The Hare & Hounds, Brentmoor Rd, GU24 9QG");
    expect(d.notes).toBe("Remembrance Sunday. Run will start at 11:02.");
    expect(d.mapUrl).toBe("https://maps.app.goo.gl/cMBE2VojzQk5LUYR7");
    expect(d.directions).toMatch(/^West End is about 2 miles south of M3/);
  });

  it("drops 'x' placeholders and '#' map links", () => {
    const html = `<div class="entry-content">
      <div class="elementor-widget" data-widget_type="heading.default">From:</div>
      <div class="elementor-widget" data-widget_type="text-editor.default"><p>x</p></div>
      <div class="elementor-widget" data-widget_type="button.default"><a href="#">Map link to Start</a></div>
    </div>`;
    expect(parseSurreyDetail(html)).toEqual({});
  });
});

describe("buildSurreyEvent", () => {
  it("lets a matching detail page's year-bearing date win", () => {
    const e = buildSurreyEvent(
      { runNumber: 2658, date: "2026-01-03", hares: "Dr Death" },
      { runNumber: 2658, date: "2027-01-03" },
    );
    expect(e.date).toBe("2027-01-03");
  });
  it("names run-less bonus trails from the hares cell and leaves hares empty", () => {
    const e = buildSurreyEvent({ date: "2027-01-01", hares: "Bonus Haggis trail", location: "Guildford" });
    expect(e).toMatchObject({ title: "Bonus Haggis trail", hares: undefined, runNumber: undefined });
  });
});

describe("SurreyHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("parses the real hareline and enriches linked runs from detail pages", async () => {
    mockedSafeFetch.mockImplementation(async (url) =>
      htmlResponse(String(url).includes("/trail-") ? DETAIL_2650_HTML : HARELINE_HTML),
    );
    const result = await new SurreyHashAdapter().fetch(makeSource(), { days: 120 });

    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => [e.runNumber, e.date])).toEqual([
      [2650, "2026-11-08"],
      [2653, "2026-11-29"],
      [undefined, "2027-01-01"],
      [2658, "2027-01-03"],
      [2659, "2027-01-10"],
    ]);
    const first = result.events[0];
    expect(first).toMatchObject({
      kennelTags: ["surrey-h3"],
      startTime: "11:00",
      location: "Donkey Town",
      locationStreet: "Brentmoor Rd, West End, Woking GU24 9QG",
      locationUrl: "https://maps.app.goo.gl/cMBE2VojzQk5LUYR7",
    });
    expect(first.title).toBeUndefined();
    // #2659 has no detail link → grid-only, sourceUrl falls back to the hareline.
    expect(result.events.at(-1)?.sourceUrl).toBe("https://surreyhashhouseharriers.com/receding-hareline/");
  });

  it("fails loud when the hareline yields zero rows", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse("<html><body><p>Coming soon</p></body></html>"));
    const result = await new SurreyHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/0 rows parsed/);
  });

  it("still emits grid rows when a detail page fetch fails", async () => {
    mockedSafeFetch.mockImplementation(async (url) =>
      String(url).includes("/trail-")
        ? ({ ok: false, status: 503, statusText: "Unavailable" } as Response)
        : htmlResponse(HARELINE_HTML),
    );
    const result = await new SurreyHashAdapter().fetch(makeSource(), { days: 120 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(5);
    expect(result.diagnosticContext?.detailFailures).toHaveLength(3);
  });
});
