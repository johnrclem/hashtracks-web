import { describe, it, expect } from "vitest";
import { parseLadiesH4Row } from "./ladies-h4-hk";

describe("parseLadiesH4Row", () => {
  const sourceUrl = "https://hkladiesh4.wixsite.com/hklh4/hareline";

  it("parses a complete row", () => {
    const cells = ["8 April 2025", "1234", "Speedy & Dizzy", "Wan Chai Park", "The Pawn"];
    const result = parseLadiesH4Row(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-04-08");
    expect(result!.kennelTags[0]).toBe("lh4-hk");
    expect(result!.runNumber).toBe(1234);
    expect(result!.hares).toBe("Speedy & Dizzy");
    expect(result!.location).toBe("Wan Chai Park");
    expect(result!.startTime).toBe("18:45");
    expect(result!.description).toBe("On On: The Pawn");
    expect(result!.sourceUrl).toBe(sourceUrl);
  });

  it("handles missing On On venue", () => {
    const cells = ["15 April 2025", "1235", "Runner Bean", "Victoria Peak"];
    const result = parseLadiesH4Row(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.description).toBeUndefined();
    expect(result!.location).toBe("Victoria Peak");
  });

  it("handles placeholder hares (TBD)", () => {
    const cells = ["22 April 2025", "1236", "TBD", "Kowloon Park", ""];
    const result = parseLadiesH4Row(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("returns null for unparseable date", () => {
    const cells = ["not a date", "1234", "Someone", "Somewhere"];
    const result = parseLadiesH4Row(cells, sourceUrl);
    expect(result).toBeNull();
  });

  it("returns null for too few cells", () => {
    const cells = ["8 April 2025"];
    const result = parseLadiesH4Row(cells, sourceUrl);
    expect(result).toBeNull();
  });

  it("handles UK-style date format", () => {
    const cells = ["8th April 2025", "1234", "Flash", "Happy Valley"];
    const result = parseLadiesH4Row(cells, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.date).toBe("2025-04-08");
  });
});
