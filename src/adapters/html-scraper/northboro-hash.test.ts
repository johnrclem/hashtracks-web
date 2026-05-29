import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseTrailBlock,
  parseTimeMention,
  parseUpcummingFreeform,
  matchSectionYear,
  stripZeroWidth,
  NorthboroHashAdapter,
} from "./northboro-hash";

// Mock browserRender
vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-abc123"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

const SOURCE_URL = "https://www.northboroh3.com/calendar";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-northboro",
    name: "Northboro H3 Website",
    url: "https://www.northboroh3.com",
    type: "HTML_SCRAPER",
    trustLevel: 5,
    scrapeFreq: "weekly",
    scrapeDays: 90,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

describe("parseTimeMention", () => {
  it("parses standard 12-hour time", () => {
    expect(parseTimeMention("start time 12:30 pm")).toBe("12:30");
  });

  it("parses bare hour with am/pm", () => {
    expect(parseTimeMention("12pm")).toBe("12:00");
    expect(parseTimeMention("11am")).toBe("11:00");
    expect(parseTimeMention("1pm")).toBe("13:00");
  });

  it("parses range like 11-12ish", () => {
    expect(parseTimeMention("11-12ish")).toBe("12:00");
    expect(parseTimeMention("10-11ish")).toBe("11:00");
  });

  it("returns undefined for no time mention", () => {
    expect(parseTimeMention("Worcester")).toBeUndefined();
  });
});

describe("parseTrailBlock", () => {
  it("parses basic trail with run number and date", () => {
    const result = parseTrailBlock(
      ["February Trail #237, 2/15/26"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-02-15",
      kennelTags: ["nbh3"],
      runNumber: 237,
      title: "NbH3 Trail #237",
      hares: undefined,
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses trail with title and hares on first line", () => {
    const result = parseTrailBlock(
      ["January Trail #236, 1/1/26, Hangover Trail, Scrumples"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-01-01",
      kennelTags: ["nbh3"],
      runNumber: 236,
      title: "Hangover Trail",
      hares: "Scrumples",
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses trail with hares on separate line", () => {
    const result = parseTrailBlock(
      ["March Trail #238, 3/14/26, Pi Day Hash", "Hares: Alice, Bob"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-03-14",
      kennelTags: ["nbh3"],
      runNumber: 238,
      title: "Pi Day Hash",
      hares: "Alice, Bob",
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses trail with location and time", () => {
    const result = parseTrailBlock(
      [
        "April Trail #239, 4/18/26",
        "Hares: HashName",
        "Worcester, start time 11-12ish",
      ],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-04-18",
      kennelTags: ["nbh3"],
      runNumber: 239,
      title: "NbH3 Trail #239",
      hares: "HashName",
      location: "Worcester",
      startTime: "12:00",
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses full date with 4-digit year", () => {
    const result = parseTrailBlock(
      ["May Trail #240, 5/16/2026"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-05-16",
      kennelTags: ["nbh3"],
      runNumber: 240,
      title: "NbH3 Trail #240",
      hares: undefined,
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("returns null for non-trail text", () => {
    expect(parseTrailBlock(["Some random text"], SOURCE_URL)).toBeNull();
    expect(parseTrailBlock(["ANCIENT HASHTORY"], SOURCE_URL)).toBeNull();
    expect(parseTrailBlock([], SOURCE_URL)).toBeNull();
  });

  it("handles location on its own line", () => {
    const result = parseTrailBlock(
      ["June Trail #241, 6/20/26", "Framingham"],
      SOURCE_URL,
    );
    expect(result?.location).toBe("Framingham");
  });

  // Field swap detection: when "title" position contains a time string
  it("detects field swap when title is a time string", () => {
    const result = parseTrailBlock(
      ["July Trail #242, 7/18/26, 12:30pm, The Summer Hash, Captain Hash"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      date: "2026-07-18",
      runNumber: 242,
      title: "The Summer Hash",
      hares: "Captain Hash",
      startTime: "12:30",
    });
  });

  it("detects field swap with bare time like '12pm'", () => {
    const result = parseTrailBlock(
      ["August Trail #243, 8/15/26, 12pm, August Hash"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      runNumber: 243,
      title: "August Hash",
      startTime: "12:00",
    });
  });

  it("handles field swap with time but no hares after title", () => {
    const result = parseTrailBlock(
      ["September Trail #244, 9/20/26, 1pm, Fall Hash"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      runNumber: 244,
      title: "Fall Hash",
      startTime: "13:00",
    });
  });

  it("splits title:hares on colon delimiter in field-swap case", () => {
    const result = parseTrailBlock(
      ["April Trail #228, 4/5/26, 12:30pm, Hoppy birfday: Cum So Hard Me Die (CSHMD) & Cuntographer (C-tog)"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      date: "2026-04-05",
      runNumber: 228,
      title: "Hoppy birfday",
      hares: "Cum So Hard Me Die (CSHMD) & Cuntographer (C-tog)",
      startTime: "12:30",
    });
  });

  it("splits title:hares on colon delimiter in normal case", () => {
    const result = parseTrailBlock(
      ["June Trail #230, 6/15/26, Blasphemahash!!: Jesus Serves and Vulva"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      runNumber: 230,
      title: "Blasphemahash!!",
      hares: "Jesus Serves and Vulva",
    });
  });

  it("does not split title when no colon delimiter present", () => {
    const result = parseTrailBlock(
      ["July Trail #242, 7/18/26, 12:30pm, The Summer Hash, Captain Hash"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      title: "The Summer Hash",
      hares: "Captain Hash",
      startTime: "12:30",
    });
  });
});

describe("stripZeroWidth / matchSectionYear", () => {
  it("strips zero-width chars Wix injects", () => {
    expect(stripZeroWidth("​2025")).toBe("2025");
    expect(stripZeroWidth("﻿July Trail #231")).toBe("July Trail #231");
  });

  it("recognizes bare year headings, including the zero-width-prefixed form", () => {
    expect(matchSectionYear("2025")).toBe(2025);
    expect(matchSectionYear("​2025")).toBe(2025);
    expect(matchSectionYear("2026")).toBe(2026);
  });

  it("recognizes the OCR typo '2O18' (letter O for zero)", () => {
    expect(matchSectionYear("2O18")).toBe(2018);
    expect(matchSectionYear("2O17")).toBe(2017);
  });

  it("rejects non-year lines and out-of-range years", () => {
    expect(matchSectionYear("January Trail #225")).toBeUndefined();
    expect(matchSectionYear("12345")).toBeUndefined();
    expect(matchSectionYear("1999")).toBeUndefined();
  });
});

describe("parseTrailBlock — section-year anchor (#1757)", () => {
  it("anchors a year-less M/D date to the section year", () => {
    const result = parseTrailBlock(
      ["July Trail # 231 7/19 12:30pm, Blue Dress R*n: Leave a Message After the Bone & Swingle"],
      SOURCE_URL,
      2025,
    );
    expect(result).toMatchObject({
      date: "2025-07-19",
      runNumber: 231,
      title: "Blue Dress R*n",
      hares: "Leave a Message After the Bone & Swingle",
      startTime: "12:30",
    });
  });

  it("resolves later months to the section year, not the prior year", () => {
    // Regression: chrono anchored at Jan-1 of the section year pushed "9/6"
    // back to 2024. Deterministic M/D parsing keeps it in 2025.
    const result = parseTrailBlock(
      ["September Trail #233, 9/6 12pm, Red Dress R*n: Scrumples"],
      SOURCE_URL,
      2025,
    );
    expect(result).toMatchObject({ date: "2025-09-06", runNumber: 233 });
  });

  it("lets an explicit two-digit year win over the section year", () => {
    const result = parseTrailBlock(
      ["May Trail #238, 5/10/26, Motherless Hashers Mimosa Mile"],
      SOURCE_URL,
      2025,
    );
    expect(result).toMatchObject({ date: "2026-05-10", runNumber: 238 });
  });
});

describe("parseTrailBlock — comma-delimited title/hares (#1758)", () => {
  it("keeps commas inside the title when an explicit 'Hares:' delimiter is present", () => {
    const result = parseTrailBlock(
      ["February Trail #237, 2/15/26, Hearts, Stars and Vampires, Hares: Scrumples, Jesus Saves"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({
      date: "2026-02-15",
      runNumber: 237,
      title: "Hearts, Stars and Vampires",
      hares: "Scrumples, Jesus Saves",
    });
    expect(result?.location).toBeUndefined();
  });

  it("treats singular 'Hare:' as the delimiter too", () => {
    const result = parseTrailBlock(
      ["January Trail #236, 1/1/26, Hangover Trail, Hare: Scrumples"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({ title: "Hangover Trail", hares: "Scrumples" });
  });

  it("does not split on an incidental 'Hare:' inside the title", () => {
    const result = parseTrailBlock(
      ["June Trail #230, 6/15/26, Welcome to the Hare: Trap, Hares: Scrumples"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({ title: "Welcome to the Hare: Trap", hares: "Scrumples" });
  });

  it("does not read a numeric range in the title as a start time", () => {
    const result = parseTrailBlock(
      ["May Trail #240, 5/16/26, 2-4 Mile Trail, Hares: Bob"],
      SOURCE_URL,
    );
    expect(result).toMatchObject({ title: "2-4 Mile Trail", hares: "Bob" });
    expect(result?.startTime).toBeUndefined();
  });
});

describe("parseUpcummingFreeform (#1759)", () => {
  it("parses a month-leading date-range block (campout) at the start date", () => {
    const { events } = parseUpcummingFreeform(
      ["July 24-26 Zombie Buffett: He is Risen", "*Please rego using Google Form"],
      SOURCE_URL,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kennelTags: ["nbh3"],
      runNumber: null,
      title: "Zombie Buffett: He is Risen",
    });
    // Start date of the range; year resolves relative to scrape date via chrono.
    expect(events[0].date).toMatch(/-07-24$/);
    // The date range "24-26" must not be misread as a time.
    expect(events[0].startTime).toBeUndefined();
    expect(events[0].location).toBeUndefined();
  });

  it("parses a weekday-leading date line with title on the previous line", () => {
    const { events } = parseUpcummingFreeform(
      [
        "Drinking Practice",
        "Dinner and a Shitshow (Round 2)",
        "Fri, June 12th 5:30pm",
        "Empire Village 446 Main St Stubridge, MA",
      ],
      SOURCE_URL,
    );
    const ev = events.find((e) => e.title === "Dinner and a Shitshow (Round 2)");
    expect(ev).toMatchObject({
      runNumber: null,
      startTime: "17:30",
      location: "Empire Village 446 Main St Stubridge, MA",
    });
    expect(ev?.date).toMatch(/-06-12$/);
  });

  it("skips boilerplate lines and never emits Trail #N rows", () => {
    const { events } = parseUpcummingFreeform(
      ["Trails are typically $7 usually paid to hare via Venmo", "March Trail #238, 3/14/26"],
      SOURCE_URL,
    );
    expect(events).toHaveLength(0);
  });

  it("parses a month-leading line whose day carries an ordinal suffix", () => {
    const { events, skipped } = parseUpcummingFreeform(["July 4th BBQ Hash"], SOURCE_URL);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runNumber: null, title: "BBQ Hash" });
    expect(events[0].date).toMatch(/-07-04$/);
    expect(skipped).toBe(0);
  });

  it("does not surface an adjacent date line as a title", () => {
    // Two back-to-back weekday date lines with no title between them: the
    // second must not adopt the first date line as its title.
    const { events } = parseUpcummingFreeform(
      ["Fri, June 12th 5:30pm", "Sat, June 13th 2pm"],
      SOURCE_URL,
    );
    expect(events.every((e) => !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(e.title ?? ""))).toBe(true);
  });
});

describe("NorthboroHashAdapter", () => {
  const adapter = new NorthboroHashAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("parses upcoming trails from rendered HTML", async () => {
    const html = `
      <html><body>
        <div data-testid="richTextElement">
          <h2>Upcumming Trails</h2>
          <p>February Trail #237, 2/15/26, Winter Hash</p>
          <p>Hares: Frosty, Snowball</p>
          <p>March Trail #238, 3/14/26, Pi Day Hash</p>
          <p>Hares: MathNerd</p>
        </div>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      date: "2026-02-15",
      kennelTags: ["nbh3"],
      runNumber: 237,
      title: "Winter Hash",
    });
    expect(result.events[1]).toMatchObject({
      date: "2026-03-14",
      kennelTags: ["nbh3"],
      runNumber: 238,
      title: "Pi Day Hash",
    });
  });

  it("parses historical trails from ANCIENT HASHTORY section", async () => {
    const html = `
      <html><body>
        <div>
          <h2>Upcumming Trails</h2>
          <p>March Trail #238, 3/14/26</p>
        </div>
        <div>
          <h2>ANCIENT HASHTORY</h2>
          <h3>2025</h3>
          <p>December Trail #235, 12/20/25, Holiday Hash, Santa</p>
          <p>November Trail #234, 11/15/25</p>
        </div>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    const december = result.events.find((e) => e.runNumber === 235);
    expect(december).toMatchObject({
      date: "2025-12-20",
      kennelTags: ["nbh3"],
      runNumber: 235,
      title: "Holiday Hash",
      hares: "Santa",
    });
  });

  it("handles missing hares and location gracefully", async () => {
    const html = `
      <html><body>
        <p>April Trail #239, 4/18/26</p>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].hares).toBeUndefined();
    expect(result.events[0].location).toBeUndefined();
  });

  it("returns fetch error when browserRender fails", async () => {
    mockedBrowserRender.mockRejectedValue(
      new Error("Browser render error (502): Navigation timeout"),
    );

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Browser render failed");
  });

  it("extracts start time from time mentions", async () => {
    const html = `
      <html><body>
        <p>May Trail #240, 5/16/26</p>
        <p>Worcester, start time 11-12ish</p>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].startTime).toBe("12:00");
    expect(result.events[0].location).toBe("Worcester");
  });

  it("includes structureHash and diagnosticContext", async () => {
    const html = `
      <html><body>
        <p>June Trail #241, 6/20/26</p>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.structureHash).toBe("mock-hash-abc123");
    expect(result.diagnosticContext).toHaveProperty("textBlocksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed", 1);
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
  });
});
