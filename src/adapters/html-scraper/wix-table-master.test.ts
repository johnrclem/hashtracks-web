import * as cheerio from "cheerio";
import { extractWixTableRows, parseDayMonthYearDate } from "./wix-table-master";

describe("extractWixTableRows", () => {
  it("returns empty when no tables are present", () => {
    const $ = cheerio.load("<html><body><p>no tables</p></body></html>");
    expect(extractWixTableRows($)).toEqual({ headers: [], rows: [] });
  });

  it("picks the first table with ≥2 <th> headers", () => {
    const $ = cheerio.load(`
      <table><tr><td>not headers</td></tr></table>
      <table>
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody><tr><td>1</td><td>2</td></tr></tbody>
      </table>
    `);
    expect(extractWixTableRows($)).toEqual({
      headers: ["A", "B"],
      rows: [["1", "2"]],
    });
  });

  it("falls back to tr:first-child th when there is no <thead>", () => {
    const $ = cheerio.load(`
      <table>
        <tr><th>X</th><th>Y</th></tr>
        <tr><td>a</td><td>b</td></tr>
      </table>
    `);
    expect(extractWixTableRows($)).toEqual({
      headers: ["X", "Y"],
      rows: [["a", "b"]],
    });
  });

  it("drops rows where every cell is empty", () => {
    const $ = cheerio.load(`
      <table>
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody>
          <tr><td></td><td></td></tr>
          <tr><td>1</td><td>2</td></tr>
        </tbody>
      </table>
    `);
    expect(extractWixTableRows($).rows).toEqual([["1", "2"]]);
  });
});

describe("parseDayMonthYearDate", () => {
  const D_MMMM_YYYY = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;
  const D_MMM_YY = /^(\d{1,2})-([A-Za-z]+)-(\d{2})$/;

  it.each([
    ["29 December 2025", D_MMMM_YYYY, "2025-12-29"],
    ["5 January 2026", D_MMMM_YYYY, "2026-01-05"],
    ["31-Jan-26", D_MMM_YY, "2026-01-31"],
    ["1-Dec-99", D_MMM_YY, "2099-12-01"],
  ])("parses %s with the supplied regex", (input, regex, expected) => {
    expect(parseDayMonthYearDate(input, regex)).toBe(expected);
  });

  it.each([
    ["", D_MMMM_YYYY, "empty"],
    ["February 16 2026", D_MMMM_YYYY, "month-first"],
    ["16 Foo 2026", D_MMMM_YYYY, "invalid month"],
    ["32 March 2026", D_MMMM_YYYY, "day out of range"],
    ["29 February 2025", D_MMMM_YYYY, "non-leap Feb 29"],
  ])("returns null for %s (%s)", (input, regex) => {
    expect(parseDayMonthYearDate(input, regex)).toBeNull();
  });
});
