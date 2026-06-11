import * as cheerio from "cheerio";
import {
  buildYiiPageUrl,
  dedupeYiiEvents,
  discoverMaxYiiPage,
  extractMaxYiiPage,
  extractTotalPagesFromSummary,
  parseYiiHarelineDate,
  parseYiiHarelinePage,
  parseYiiHarelineRow,
  splitOccasion,
} from "./yii-hareline";
import type { RawEventData } from "../types";

describe("parseYiiHarelineDate", () => {
  it("parses 04 Jan 2003", () => {
    expect(parseYiiHarelineDate("04 Jan 2003")).toBe("2003-01-04");
  });
  it("parses 21 Feb 2026", () => {
    expect(parseYiiHarelineDate("21 Feb 2026")).toBe("2026-02-21");
  });
  it("parses 4-Jan-26 (dashed short)", () => {
    expect(parseYiiHarelineDate("4-Jan-26")).toBe("2026-01-04");
  });
  it("rejects empty + garbage", () => {
    expect(parseYiiHarelineDate("")).toBeNull();
    expect(parseYiiHarelineDate("tbc")).toBeNull();
    expect(parseYiiHarelineDate("04/Xyz/2003")).toBeNull();
  });
});

describe("extractMaxYiiPage", () => {
  it("returns the highest page number in any href", () => {
    const html = `<a href="?r=site/hareline&page=1">1</a>
      <a href="?r=site/hareline&page=88">88</a>
      <a href="?r=site/hareline&page=5">5</a>`;
    expect(extractMaxYiiPage(html)).toBe(88);
  });
  it("returns 1 when no pagination links", () => {
    expect(extractMaxYiiPage("<html></html>")).toBe(1);
  });
  it("handles HTML-entity-encoded ampersands (e.g. KL Full Moon)", () => {
    const html = `<a href="?r=site%2Fhareline&amp;page=14">14</a>
      <a href="?r=site%2Fhareline&amp;page=2">2</a>`;
    expect(extractMaxYiiPage(html)).toBe(14);
  });
});

describe("extractTotalPagesFromSummary", () => {
  // Contract: called on PAGE 1, where the X-Y range is a full page so per-page
  // is inferred correctly. (On a partial last page the inference would be off,
  // but the adapter + backfill always pass page-1 HTML.)
  it("computes pages from the 'Showing X-Y of TOTAL items' summary", () => {
    // PH3: 13 per page, 1,160 items → 90 pages (links alone stop at 89, #2085).
    expect(
      extractTotalPagesFromSummary(`<div>Showing <b>1-13</b> of <b>1,160</b> items</div>`),
    ).toBe(90);
  });
  it("handles a plain-text (un-bolded) summary", () => {
    // 12 per page, 144 items → 12 pages (KL Full Moon scale).
    expect(extractTotalPagesFromSummary(`Showing 1-12 of 144 items`)).toBe(12);
  });
  it("returns null when no summary present", () => {
    expect(extractTotalPagesFromSummary("<html></html>")).toBeNull();
  });
});

describe("discoverMaxYiiPage", () => {
  it("takes the summary count when it exceeds the visible page links (#2085)", () => {
    // Links top out at 89 but the summary says 90 pages.
    const html = `<a href="?r=site/hareline&page=89">89</a>
      <div>Showing <b>1-13</b> of <b>1,160</b> items</div>`;
    expect(discoverMaxYiiPage(html)).toBe(90);
  });
  it("falls back to link scan when no summary is present", () => {
    expect(discoverMaxYiiPage(`<a href="?page=14">14</a>`)).toBe(14);
  });
});

describe("splitOccasion", () => {
  it("emits description:null for a blank cell when the column is PRESENT (clear stale)", () => {
    // Column present but empty → explicit clear so a prior scrape's description
    // can't linger after the source removes the Occasion.
    expect(splitOccasion("")).toEqual({ title: undefined, description: null });
    expect(splitOccasion("   ")).toEqual({ title: undefined, description: null });
    expect(splitOccasion(undefined)).toEqual({ title: undefined, description: null });
  });

  it("emits description:undefined when the column is genuinely ABSENT (preserve)", () => {
    expect(splitOccasion(undefined, false)).toEqual({ title: undefined, description: undefined });
    expect(splitOccasion("", false)).toEqual({ title: undefined, description: undefined });
  });

  it.each([
    // [occasion, expectedTitle] — short clean labels → title + description cleared
    ["Christmas Run", "Christmas Run"],
    ["CNY Run", "CNY Run"],
    ["Silver Centum Run", "Silver Centum Run"],
    ["Merdeka Run", "Merdeka Run"],
    ["New Year & Belated Birthday Run", "New Year & Belated Birthday Run"],
    ["7-Eleven Run", "7-Eleven Run"], // bare hyphen (no spaces) is not a separator
    ["St. George's Day", "St. George's Day"],
    ["Interhowl / SHOT", "Interhowl / SHOT"], // KLFM — slash is not a separator
    ["Mother's 80th preamble", "Mother's 80th preamble"], // KLFM
  ])("treats %j as a pure label title (description cleared)", (occasion, expected) => {
    // A clean label carries no prose, so description is cleared (null), not stale.
    expect(splitOccasion(occasion)).toEqual({ title: expected, description: null });
  });

  it.each([
    // [occasion, expectedTitle] — prose/instructions: full string → description,
    // leading clean label → title
    ["Torchlight Run - Run Starts at 7pm!!!", "Torchlight Run"],
    ["The X Run (Guest Fee Rm80 including On-On)", "The X Run"],
    ["JM's Run - Run starts at 5:30pm - headtorch is mandatory!", "JM's Run"],
    ["Outstation Run - there is NO LOCAL RUN this weekend", "Outstation Run"],
  ])("splits rich occasion %j into title + description", (occasion, expectedTitle) => {
    expect(splitOccasion(occasion)).toEqual({ title: expectedTitle, description: occasion });
  });

  it("leaves title undefined when the leading label is not clean (time-only)", () => {
    const occ = "Run starts at 5:30pm - headtorch is mandatory!";
    expect(splitOccasion(occ)).toEqual({ title: undefined, description: occ });
  });

  it("treats a >=60-char label-shaped cell as description only (no title)", () => {
    const occ = "A very long single-clause occasion string that is well over sixty chars";
    expect(occ.length).toBeGreaterThanOrEqual(60);
    expect(splitOccasion(occ)).toEqual({ title: undefined, description: occ });
  });
});

describe("parseYiiHarelineRow", () => {
  const config = {
    kennelTag: "ph3-my",
    startTime: "16:00",
  };

  it("parses a full PH3 row", () => {
    const cells = [
      "2479",
      "11 Apr 2026",
      "Raymond Lai",
      "Pantai Remis (Remis Beach)",
      "",
      "Wim Schoemaker",
      "",
    ];
    const event = parseYiiHarelineRow(cells, config, "https://ph3.org/index.php?r=site/hareline");
    expect(event).not.toBeNull();
    expect(event?.runNumber).toBe(2479);
    expect(event?.date).toBe("2026-04-11");
    expect(event?.hares).toBe("Raymond Lai");
    expect(event?.location).toBe("Pantai Remis (Remis Beach)");
    expect(event?.startTime).toBe("16:00");
    expect(event?.kennelTags[0]).toBe("ph3-my");
  });

  it("extracts a clean label Occasion into title (description cleared to null)", () => {
    const cells = ["2480", "18 Apr 2026", "Barry Sage", "Bukit Bayu", "St. George's Day"];
    const event = parseYiiHarelineRow(cells, config, "x");
    expect(event?.title).toBe("St. George's Day");
    // Column present, no prose → explicit clear so stale descriptions don't linger.
    expect(event?.description).toBeNull();
  });

  it("routes a prose/instruction Occasion into description with a label title", () => {
    const cells = ["2485", "23 May 2026", "Wim", "Somewhere", "Torchlight Run - Run Starts at 7pm!!!"];
    const event = parseYiiHarelineRow(cells, config, "x");
    expect(event?.title).toBe("Torchlight Run");
    expect(event?.description).toBe("Torchlight Run - Run Starts at 7pm!!!");
  });

  it("clears description (null) when the Occasion cell is blank but present", () => {
    const cells = ["2479", "11 Apr 2026", "Raymond Lai", "Pantai Remis", ""];
    const event = parseYiiHarelineRow(cells, config, "x");
    expect(event?.title).toBeUndefined();
    expect(event?.description).toBeNull();
  });

  it("preserves description (undefined) when the row has no Occasion column at all", () => {
    // Only 4 cells — index 4 (occasion) is absent, so preserve rather than clear.
    const cells = ["2479", "11 Apr 2026", "Raymond Lai", "Pantai Remis"];
    const event = parseYiiHarelineRow(cells, config, "x");
    expect(event?.description).toBeUndefined();
  });

  it("parses a KL Full Moon row (Occasion → title, additive)", () => {
    const klfm = { kennelTag: "klfmh3", startTime: "18:00" };
    const cells = ["144", "12 Sep 2026", "Cougar", "Kuala Lumpur", "Interhowl / SHOT"];
    const event = parseYiiHarelineRow(cells, klfm, "https://klfullmoonhash.com/index.php?r=site/hareline");
    expect(event?.runNumber).toBe(144);
    expect(event?.kennelTags[0]).toBe("klfmh3");
    expect(event?.title).toBe("Interhowl / SHOT");
    expect(event?.description).toBeNull();
  });

  it("drops placeholder rows with run number 0", () => {
    const cells = ["0", "10 May 2017", "-hare required-", "Denai Alam", "Tripartite"];
    expect(parseYiiHarelineRow(cells, config, "x")).toBeNull();
  });

  it("nulls out hare-required placeholder hares", () => {
    const cells = ["1234", "11 Apr 2026", "-hare required-", "Somewhere"];
    const event = parseYiiHarelineRow(cells, config, "x");
    expect(event?.hares).toBeUndefined();
  });

  it("rejects row missing run number or date", () => {
    expect(parseYiiHarelineRow(["", "11 Apr 2026"], config, "x")).toBeNull();
    expect(parseYiiHarelineRow(["1234", ""], config, "x")).toBeNull();
    expect(parseYiiHarelineRow(["1234", "junk"], config, "x")).toBeNull();
  });

  it("respects custom columnMap", () => {
    const cells = ["A", "B", "99", "12 Jun 2026", "Hare Name", "Location"];
    const custom = {
      kennelTag: "x",
      columnMap: { runNumber: 2, date: 3, hare: 4, location: 5 },
    };
    const event = parseYiiHarelineRow(cells, custom, "x");
    expect(event?.runNumber).toBe(99);
    expect(event?.date).toBe("2026-06-12");
    expect(event?.hares).toBe("Hare Name");
    expect(event?.location).toBe("Location");
  });
});

describe("parseYiiHarelinePage", () => {
  const html = `
    <table class="table custom-table">
      <tr><th>Run No</th><th>Run Date</th><th>Hare</th><th>Venue</th><th>Occasion</th></tr>
      <tr><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>2479</td><td>11 Apr 2026</td><td>Raymond Lai</td><td>Pantai Remis</td><td></td></tr>
      <tr><td>2480</td><td>18 Apr 2026</td><td>Barry Sage</td><td>Bukit Bayu</td><td>St. George's Day</td></tr>
      <tr><td>0</td><td>10 May 2017</td><td>-hare required-</td><td>Denai Alam</td><td>Tripartite</td></tr>
    </table>
  `;
  it("parses only valid rows from the first table", () => {
    const $ = cheerio.load(html);
    const events = parseYiiHarelinePage($, { kennelTag: "ph3-my" }, "https://ph3.org");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.runNumber)).toEqual([2479, 2480]);
  });
});

describe("dedupeYiiEvents", () => {
  const ev = (runNumber: number, date: string): RawEventData => ({
    runNumber,
    date,
    kennelTags: ["ph3-my"],
  });

  it("drops duplicate (runNumber, date) pairs, keeping the first", () => {
    const out = dedupeYiiEvents([ev(2479, "2026-04-11"), ev(2479, "2026-04-11"), ev(2480, "2026-04-18")]);
    expect(out.map((e) => e.runNumber)).toEqual([2479, 2480]);
  });

  it("keeps same run number on different dates (re-run / reschedule)", () => {
    const out = dedupeYiiEvents([ev(2479, "2026-04-11"), ev(2479, "2026-04-18")]);
    expect(out).toHaveLength(2);
  });
});

describe("buildYiiPageUrl", () => {
  it("returns base URL as-is for page 1", () => {
    expect(buildYiiPageUrl("https://ph3.org/index.php?r=site/hareline", 1))
      .toBe("https://ph3.org/index.php?r=site/hareline");
  });
  it("appends &page=N when URL already has ?", () => {
    expect(buildYiiPageUrl("https://ph3.org/index.php?r=site/hareline", 88))
      .toBe("https://ph3.org/index.php?r=site/hareline&page=88");
  });
  it("appends ?page=N when URL has no query", () => {
    expect(buildYiiPageUrl("https://example.com/path", 3)).toBe("https://example.com/path?page=3");
  });
});
