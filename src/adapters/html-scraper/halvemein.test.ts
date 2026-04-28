import { describe, it, expect } from "vitest";
import {
  parseHalveMeinRow,
  normalizeHalveMeinMonths,
  parseHalveMeinTime,
} from "./halvemein";

describe("normalizeHalveMeinMonths", () => {
  it("replaces sextembeer with September", () => {
    expect(normalizeHalveMeinMonths("Sextembeer 5, 1PM")).toBe("September 5, 1PM");
  });

  it("replaces hashtobeer with October", () => {
    expect(normalizeHalveMeinMonths("Hashtobeer 7, 6PM")).toBe("October 7, 6PM");
  });

  it("replaces novembeer with November", () => {
    expect(normalizeHalveMeinMonths("Novembeer 14, 1PM")).toBe("November 14, 1PM");
  });

  it("replaces decembeer with December", () => {
    expect(normalizeHalveMeinMonths("Decembeer 25, 6PM")).toBe("December 25, 6PM");
  });

  it("is case-insensitive", () => {
    expect(normalizeHalveMeinMonths("SEXTEMBEER 16, 6PM")).toBe("September 16, 6PM");
    expect(normalizeHalveMeinMonths("hashtobeer 31, 1PM")).toBe("October 31, 1PM");
  });

  it("passes standard months through unchanged", () => {
    expect(normalizeHalveMeinMonths("March 18, 6PM")).toBe("March 18, 6PM");
    expect(normalizeHalveMeinMonths("January 7, 1PM")).toBe("January 7, 1PM");
  });
});

describe("parseHalveMeinTime", () => {
  it("parses compact '6PM' format", () => {
    expect(parseHalveMeinTime("March 18, 6PM")).toBe("18:00");
  });

  it("parses compact '1PM' format", () => {
    expect(parseHalveMeinTime("January 7, 1PM")).toBe("13:00");
  });

  it("parses compact '11AM' format", () => {
    expect(parseHalveMeinTime("June 20, 11AM")).toBe("11:00");
  });

  it("parses compact '12PM' (noon)", () => {
    expect(parseHalveMeinTime("November 27, 12PM")).toBe("12:00");
  });

  it("parses compact '8PM' format", () => {
    expect(parseHalveMeinTime("June 19, 8PM")).toBe("20:00");
  });

  it("falls back to standard colon format", () => {
    expect(parseHalveMeinTime("March 19, 2026 6:00 PM")).toBe("18:00");
  });

  it("returns undefined for no time", () => {
    expect(parseHalveMeinTime("no time here")).toBeUndefined();
  });
});

describe("parseHalveMeinRow", () => {
  const sourceUrl = "https://www.hmhhh.com/index.php?log=upcoming.con";

  it("parses a complete row with all fields (standard format)", () => {
    const cells = [
      "825",
      "Wednesday",
      "March 19, 2026 6:00 PM",
      "Crossroads Brewing, Athens, NY",
      "Hashy McHashface",
      "Directions",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(825);
    expect(result!.date).toBe("2026-03-19");
    expect(result!.startTime).toBe("18:00");
    expect(result!.location).toBe("Crossroads Brewing, Athens, NY");
    expect(result!.hares).toBe("Hashy McHashface");
    expect(result!.kennelTags[0]).toBe("halvemein");
    expect(result!.title).toBe("HMHHH #825");
  });

  it("parses winter afternoon time", () => {
    const cells = [
      "820",
      "Wednesday",
      "January 7, 2026 1:00 PM",
      "Albany, NY",
      "Some Hare",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-01-07");
    expect(result!.startTime).toBe("13:00");
  });

  it("handles missing hare (TBD)", () => {
    const cells = [
      "826",
      "Wednesday",
      "April 2, 2026 6:00 PM",
      "Saratoga Springs, NY",
      "TBD",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("handles missing run number (text fallback)", () => {
    const cells = [
      "",
      "Saturday",
      "June 20, 2026 12:00 PM",
      "Thacher State Park",
      "KNURD Weekend",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBeUndefined();
    expect(result!.title).toBe("HMHHH Trail");
  });

  it("returns null for too few cells", () => {
    const cells = ["825", "Wednesday", "March 19"];
    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).toBeNull();
  });

  it("returns null when date cannot be parsed", () => {
    const cells = [
      "825",
      "Wednesday",
      "not a date",
      "Some Place",
      "Some Hare",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).toBeNull();
  });

  it("handles row with empty location", () => {
    const cells = [
      "827",
      "Wednesday",
      "May 13, 2026 6:00 PM",
      "",
      "Running Joke",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.location).toBeUndefined();
    expect(result!.hares).toBe("Running Joke");
  });

  it("filters 'Sign Up!' as hare placeholder", () => {
    const result = parseHalveMeinRow(
      ["821", "Wednesday", "March 18, 2026 6:00 PM", "TBD", "Sign Up!"],
      sourceUrl,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("filters 'Sign Up!' with non-breaking space as hare placeholder", () => {
    const result = parseHalveMeinRow(
      ["821", "Wednesday", "March 18, 2026 6:00 PM", "TBD", "Sign\u00A0Up!"],
      sourceUrl,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  // --- New tests for bug fixes ---

  it("parses custom month Sextembeer", () => {
    const cells = [
      "834",
      "Wednesday",
      "Sextembeer 16, 6PM",
      "",
      "Sign Up!",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.date).toMatch(/^\d{4}-09-16$/);
    expect(result!.startTime).toBe("18:00");
  });

  it("parses custom month Hashtobeer", () => {
    const cells = [
      "835",
      "Wednesday",
      "Hashtobeer 7, 6PM",
      "",
      "Sign Up!",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.date).toMatch(/^\d{4}-10-07$/);
  });

  it("parses custom month Novembeer", () => {
    const cells = [
      "840",
      "Saturday",
      "Novembeer 14, 1PM",
      "",
      "Sign Up!",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.date).toMatch(/^\d{4}-11-14$/);
    expect(result!.startTime).toBe("13:00");
  });

  it("parses custom month Decembeer", () => {
    const cells = [
      "842",
      "Saturday",
      "Decembeer 12, 1PM",
      "Oh Bar",
      "Santa Piggy",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.date).toMatch(/^\d{4}-12-12$/);
    expect(result!.location).toBe("Oh Bar");
    expect(result!.hares).toBe("Santa Piggy");
  });

  it("parses compact time '6PM' without colon", () => {
    const cells = [
      "821",
      "Wednesday",
      "March 18, 6PM",
      "",
      "Sign Up!",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBe("18:00");
  });

  it("extracts event name from cell0Html with <br>", () => {
    const cells = [
      "821St Paddy's Dayish Hash",
      "Wednesday",
      "March 18, 2026 6:00 PM",
      "",
      "Sign Up!",
    ];
    const cell0Html = "821<br>St Paddy's Dayish Hash";

    const result = parseHalveMeinRow(cells, sourceUrl, cell0Html);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(821);
    expect(result!.title).toBe("HMHHH #821: St Paddy's Dayish Hash");
  });

  it("extracts event name from cell0Html with <font> wrapper", () => {
    const cells = [
      "828KNURD XXII (K)Northestern Unofficial Run for Drunks!",
      "Saturday",
      "June 20, 2026 11:00 AM",
      "Shiggalicious!",
      "Counterfeit Dick / Two Minute Ride / Easy 123",
    ];
    const cell0Html =
      '<font color="#FF0000">828<br>KNURD XXII (K)Northestern Unofficial Run for Drunks!</font>';

    const result = parseHalveMeinRow(cells, sourceUrl, cell0Html);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(828);
    expect(result!.title).toBe(
      "HMHHH #828: KNURD XXII (K)Northestern Unofficial Run for Drunks!",
    );
  });

  it("suppresses generic 'Hash' in title when using cell0Html", () => {
    const cells = [
      "829Hash",
      "Wednesday",
      "July 8, 2026 6:00 PM",
      "",
      "Sign Up!",
    ];
    const cell0Html = "829<br>Hash";

    const result = parseHalveMeinRow(cells, sourceUrl, cell0Html);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(829);
    expect(result!.title).toBe("HMHHH #829");
  });

  it("suppresses generic 'Hash' in title with text fallback", () => {
    const cells = [
      "829 Hash",
      "Wednesday",
      "July 8, 2026 6:00 PM",
      "",
      "Sign Up!",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(829);
    expect(result!.title).toBe("HMHHH #829");
  });

  it("handles no run number with event name in cell0Html", () => {
    const cells = [
      "KNURD XXII Camp Crawl",
      "Friday",
      "June 19, 2026 8:00 PM",
      "Camp Crawl",
      "SOH4 Crewe",
    ];
    const cell0Html = '<font color="#FF0000">KNURD XXII Camp Crawl</font>';

    const result = parseHalveMeinRow(cells, sourceUrl, cell0Html);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBeUndefined();
    expect(result!.title).toBe("HMHHH: KNURD XXII Camp Crawl");
  });

  it("extracts event name with text fallback (no cell0Html)", () => {
    const cells = [
      "831 Adiredneck XVIII Hash",
      "Saturday",
      "August 8, 2026 1:00 PM",
      "Wells, NY",
      "Willy Wanker",
    ];

    const result = parseHalveMeinRow(cells, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(831);
    expect(result!.title).toBe("HMHHH #831: Adiredneck XVIII Hash");
  });
});
