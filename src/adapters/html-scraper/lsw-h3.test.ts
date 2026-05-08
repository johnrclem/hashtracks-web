import { describe, it, expect } from "vitest";
import { parseLswDate, parseLswRow } from "./lsw-h3";

describe("parseLswDate", () => {
  it("parses DD Mon YY format", () => {
    expect(parseLswDate("09 Apr 25")).toBe("2025-04-09");
    expect(parseLswDate("23 Jul 26")).toBe("2026-07-23");
    expect(parseLswDate("01 Jan 27")).toBe("2027-01-01");
  });

  it("parses DD Mon YYYY format", () => {
    expect(parseLswDate("09 Apr 2025")).toBe("2025-04-09");
  });

  it("returns null for invalid input", () => {
    expect(parseLswDate("")).toBeNull();
    expect(parseLswDate("not a date")).toBeNull();
    expect(parseLswDate("32 Jan 25")).toBeNull(); // invalid day
    expect(parseLswDate("09 Xyz 25")).toBeNull(); // invalid month
  });

  it("rejects invalid dates like Feb 30", () => {
    expect(parseLswDate("30 Feb 25")).toBeNull();
  });
});

describe("parseLswRow", () => {
  const sourceUrl = "https://www.datadesignfactory.com/lsw/hareline.htm";

  it("parses a complete row, routing DESCRIPTION column to description only (#1241)", () => {
    const cells = ["09 Apr 25", "2402", "Indy and Inflatable", "Chai Wan"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-04-09");
    expect(result!.kennelTags[0]).toBe("lsw-h3");
    expect(result!.runNumber).toBe(2402);
    expect(result!.hares).toBe("Indy and Inflatable");
    // Source has no location column. DESCRIPTION is editorial theme text
    // (event themes, district hints, etc.) — never write it to `location`.
    expect(result!.location).toBeUndefined();
    expect(result!.description).toBe("Chai Wan");
    expect(result!.startTime).toBe("18:30");
    expect(result!.sourceUrl).toBe(sourceUrl);
  });

  it.each([
    ["Cinco de Mayo"],
    ["Summer Solstice Run"],
    ["Handover Day"],
    ["Birthday run"],
    ["LSW Reunion 2026, Bedford"],
    ["ANZAC Day Run"],
    ["Shek O"],
    ["Chai Wan"],
  ])("never maps DESCRIPTION %p to location (#1241)", (desc) => {
    const cells = ["29 Apr 26", "2595", "Hopeless", desc];
    const result = parseLswRow(cells, sourceUrl);
    expect(result!.location).toBeUndefined();
    expect(result!.description).toBe(desc);
  });

  it("handles missing hares", () => {
    const cells = ["16 Apr 25", "2403", "", "Shek O"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
    expect(result!.location).toBeUndefined();
    expect(result!.description).toBe("Shek O");
  });

  it("handles placeholder hares", () => {
    const cells = ["16 Apr 25", "2403", "TBD", ""];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("handles missing location cell", () => {
    const cells = ["23 Apr 25", "2404", "Hash Flash"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.location).toBeUndefined();
    expect(result!.description).toBeUndefined();
  });

  it("returns null for unparseable date", () => {
    const cells = ["not a date", "2400", "Someone"];
    const result = parseLswRow(cells, sourceUrl);
    expect(result).toBeNull();
  });

  it("returns null for too few cells", () => {
    const cells = ["09 Apr 25"];
    const result = parseLswRow(cells, sourceUrl);
    expect(result).toBeNull();
  });
});
