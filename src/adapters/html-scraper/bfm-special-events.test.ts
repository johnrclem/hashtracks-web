import { describe, it, expect } from "vitest";
import { parseBfmDate, parseBfmSpecialEvents } from "./bfm-special-events";

describe("parseBfmDate", () => {
  it("parses a single 'YYYY Date: Weekday, Month Dayth' line", () => {
    expect(parseBfmDate("2026 Date: Saturday, August 8th (Information Here)")).toEqual({
      date: "2026-08-08",
      endDate: undefined,
    });
  });

  it("parses a multi-day range into date + endDate", () => {
    expect(parseBfmDate("2026 Date: Thursday, October 1st – Sunday, October 4th (Rego Here)")).toEqual({
      date: "2026-10-01",
      endDate: "2026-10-04",
    });
  });

  it("trusts the 'YYYY Date:' prefix year over a conflicting trailing year (AGM typo)", () => {
    // Source reads "2027 Date: Thursday, February 4th, 2026" — the prefix is
    // authoritative (Feb 4 2027 is the Thursday the text names).
    expect(parseBfmDate("2027 Date: Thursday, February 4th, 2026")).toEqual({
      date: "2027-02-04",
      endDate: undefined,
    });
  });

  it("ignores the weekday word and only treats month names as months", () => {
    // "Sunday" must not be mistaken for a month; "November 22nd" is the date.
    expect(parseBfmDate("2026 Date: Sunday, November 22nd")).toEqual({
      date: "2026-11-22",
      endDate: undefined,
    });
  });

  it("returns null for 'No Current Date' and text without a YYYY Date: prefix", () => {
    expect(parseBfmDate("No Current Date")).toBeNull();
    expect(parseBfmDate("Join us for a great time")).toBeNull();
  });

  it("fails closed on an impossible day rather than rolling it to another month", () => {
    // A "February 31st" typo must NOT silently normalize to March 3.
    expect(parseBfmDate("2026 Date: Saturday, February 31st")).toBeNull();
    expect(parseBfmDate("2026 Date: Thursday, April 31st")).toBeNull();
    expect(parseBfmDate("2026 Date: November 32nd")).toBeNull();
  });

  it("respects leap years (Feb 29 valid in 2028, rejected in 2026)", () => {
    expect(parseBfmDate("2028 Date: Tuesday, February 29th")).toEqual({ date: "2028-02-29", endDate: undefined });
    expect(parseBfmDate("2026 Date: Sunday, February 29th")).toBeNull();
  });

  it("omits endDate when the range end is not after the start", () => {
    expect(parseBfmDate("2026 Date: August 8th")).toEqual({ date: "2026-08-08", endDate: undefined });
  });
});

const FIXTURE = `
<div class="entry-content">
  <p class="has-medium-font-size wp-block-paragraph"><strong>Mayor’s Cup</strong></p>
  <p class="wp-block-paragraph">2026 Date: Saturday, August 8th (<a href="#">Information Here</a>)</p>
  <p class="has-medium-font-size wp-block-paragraph"><strong>Fearadelphia</strong></p>
  <p class="wp-block-paragraph">2026 Date: Thursday, October 1st – Sunday, October 4th (Rego Here)</p>
  <p class="has-medium-font-size wp-block-paragraph"><strong>LVH3+BFM Campout</strong></p>
  <p class="wp-block-paragraph">No Current Date</p>
  <p class="has-medium-font-size wp-block-paragraph"><strong>AGM</strong></p>
  <p class="wp-block-paragraph">2027 Date: Thursday, February 4th, 2026</p>
</div>
`;

describe("parseBfmSpecialEvents", () => {
  it("emits one event per titled section with a parseable date, skipping 'No Current Date'", () => {
    const events = parseBfmSpecialEvents(FIXTURE);
    expect(events).toEqual([
      { date: "2026-08-08", endDate: undefined, title: "Mayor’s Cup", kennelTags: ["bfm"] },
      { date: "2026-10-01", endDate: "2026-10-04", title: "Fearadelphia", kennelTags: ["bfm"] },
      { date: "2027-02-04", endDate: undefined, title: "AGM", kennelTags: ["bfm"] },
    ]);
  });

  it("does not emit the dateless campout", () => {
    const titles = parseBfmSpecialEvents(FIXTURE).map((e) => e.title);
    expect(titles).not.toContain("LVH3+BFM Campout");
  });
});
