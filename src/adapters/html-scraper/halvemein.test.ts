import { describe, it, expect } from "vitest";
import { parseHalveMeinRow } from "./halvemein";

describe("parseHalveMeinRow", () => {
  const sourceUrl = "https://www.hmhhh.com/index.php?log=upcoming.con";

  it("parses a complete row with all fields", () => {
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
    expect(result!.kennelTag).toBe("HMHHH");
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

  it("handles missing run number", () => {
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
});
