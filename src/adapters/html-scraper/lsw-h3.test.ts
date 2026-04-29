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

  it("parses a complete row, mapping DESCRIPTION column to both location and description (#873, #962)", () => {
    const cells = ["09 Apr 25", "2402", "Indy and Inflatable", "Chai Wan"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-04-09");
    expect(result!.kennelTags[0]).toBe("lsw-h3");
    expect(result!.runNumber).toBe(2402);
    expect(result!.hares).toBe("Indy and Inflatable");
    // Source DESCRIPTION column carries either HK district names (legacy) or
    // event themes (current). Both interpretations are useful so emit to
    // location AND description — the merge layer will reconcile.
    expect(result!.location).toBe("Chai Wan");
    expect(result!.description).toBe("Chai Wan");
    expect(result!.startTime).toBe("18:30");
    expect(result!.sourceUrl).toBe(sourceUrl);
  });

  it("routes themed/event DESCRIPTION values to description only (#962)", () => {
    // Themed text isn't a usable venue name. sanitizeLocation downstream
    // doesn't reject arbitrary strings, so leaving "ANZAC Day Run" on
    // location would surface it as a venue on the canonical event.
    const cells = ["29 Apr 26", "2595", "Indyanus, Octopussy & HOTR", "ANZAC Day Run"];
    const result = parseLswRow(cells, sourceUrl);
    expect(result!.description).toBe("ANZAC Day Run");
    expect(result!.location).toBeUndefined();
  });

  it("keeps short district-shaped DESCRIPTION values on both location and description (#873/#962)", () => {
    // Two-token / single-word values without theme markers look like venues
    // and stay on both fields for backward compatibility.
    const cells = ["06 May 26", "2596", "Hopeless", "Shek O"];
    const result = parseLswRow(cells, sourceUrl);
    expect(result!.location).toBe("Shek O");
    expect(result!.description).toBe("Shek O");
  });

  it("handles missing hares", () => {
    const cells = ["16 Apr 25", "2403", "", "Shek O"];
    const result = parseLswRow(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
    // Short district-shaped value: routed to both fields.
    expect(result!.location).toBe("Shek O");
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
