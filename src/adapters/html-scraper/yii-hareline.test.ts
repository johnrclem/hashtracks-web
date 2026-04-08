import * as cheerio from "cheerio";
import {
  buildYiiPageUrl,
  extractMaxYiiPage,
  parseYiiHarelineDate,
  parseYiiHarelinePage,
  parseYiiHarelineRow,
} from "./yii-hareline";

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
    expect(event?.kennelTag).toBe("ph3-my");
  });

  it("extracts title from Occasion column", () => {
    const cells = ["2480", "18 Apr 2026", "Barry Sage", "Bukit Bayu", "St. George's Day"];
    const event = parseYiiHarelineRow(cells, config, "x");
    expect(event?.title).toBe("St. George's Day");
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
