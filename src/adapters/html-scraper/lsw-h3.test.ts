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

  it("parses a complete row", () => {
    const cells = ["09 Apr 25", "2402", "Indy and Inflatable", "Night Run"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-04-09");
    expect(result!.kennelTag).toBe("lsw-h3");
    expect(result!.runNumber).toBe(2402);
    expect(result!.hares).toBe("Indy and Inflatable");
    expect(result!.description).toBe("Night Run");
    expect(result!.startTime).toBe("18:30");
    expect(result!.sourceUrl).toBe(sourceUrl);
  });

  it("handles missing hares", () => {
    const cells = ["16 Apr 25", "2403", "", "Mystery Run"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
    expect(result!.description).toBe("Mystery Run");
  });

  it("handles placeholder hares", () => {
    const cells = ["16 Apr 25", "2403", "TBD", ""];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("handles missing description", () => {
    const cells = ["23 Apr 25", "2404", "Hash Flash"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
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
