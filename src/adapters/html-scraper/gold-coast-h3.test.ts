import { describe, expect, it } from "vitest";
import { parseGoldCoastDate, parseGoldCoastRow } from "./gold-coast-h3";

const URL = "https://www.goldcoasthash.org/hareline/";

describe("gold-coast-h3 parseGoldCoastDate", () => {
  it("parses Month D YYYY", () => {
    expect(parseGoldCoastDate("April 13 2026")).toBe("2026-04-13");
    expect(parseGoldCoastDate("January 6 2026")).toBe("2026-01-06");
  });

  it("returns null on junk", () => {
    expect(parseGoldCoastDate("")).toBeNull();
    expect(parseGoldCoastDate("13/04/2026")).toBeNull();
  });
});

describe("gold-coast-h3 parseGoldCoastRow", () => {
  it("parses a full row and synthesizes title with theme suffix (#1225)", () => {
    const e = parseGoldCoastRow(["April 13 2026", "2500", "Hierarchy", "Birthday"], URL);
    expect(e).not.toBeNull();
    expect(e!.date).toBe("2026-04-13");
    expect(e!.runNumber).toBe(2500);
    expect(e!.kennelTags[0]).toBe("gch3-au");
    expect(e!.hares).toBe("Hierarchy");
    expect(e!.title).toBe("Gold Coast H3 Run #2500 — Birthday");
  });

  it("synthesizes plain 'Run #N' title when theme column is empty (#1225)", () => {
    const e = parseGoldCoastRow(["April 20 2026", "2501", "Rug", ""], URL);
    expect(e).not.toBeNull();
    expect(e!.title).toBe("Gold Coast H3 Run #2501");
  });

  it("returns null on header row", () => {
    expect(parseGoldCoastRow(["Date", "Run Number", "Hare", "Theme"], URL)).toBeNull();
  });

  it("returns null when run number missing", () => {
    expect(parseGoldCoastRow(["April 27 2026", "", "Hare", "Theme"], URL)).toBeNull();
  });
});
