import { describe, it, expect } from "vitest";
import { parseEventHeader, parseEventDetails } from "./renegade-h3";

describe("RenegadeH3Adapter", () => {
  describe("parseEventHeader", () => {
    it("parses standard header with 2-digit year", () => {
      const result = parseEventHeader("#293 - 03/21/26 - Anal Puttin' on the Green Trail");
      expect(result).toEqual({
        runNumber: 293,
        date: "2026-03-21",
        title: "Anal Puttin' on the Green Trail",
      });
    });

    it("parses header with 4-digit year", () => {
      const result = parseEventHeader("#290 - 01/09/2026 - Good Will Wrapping Party");
      expect(result).toEqual({
        runNumber: 290,
        date: "2026-01-09",
        title: "Good Will Wrapping Party",
      });
    });

    it("parses header with single-digit month/day", () => {
      const result = parseEventHeader("#100 - 1/5/25 - New Year Hash");
      expect(result).toEqual({
        runNumber: 100,
        date: "2025-01-05",
        title: "New Year Hash",
      });
    });

    it("returns null for non-header text", () => {
      expect(parseEventHeader("Hares needed!")).toBeNull();
      expect(parseEventHeader("2026")).toBeNull();
      expect(parseEventHeader("")).toBeNull();
    });

    it("returns null for year heading", () => {
      expect(parseEventHeader("2026")).toBeNull();
    });
  });

  describe("parseEventDetails", () => {
    it("parses full event detail block", () => {
      const text = [
        "Hares: Can't feel Clap... Saran Clap and Can't Feel It",
        "Where: Meet at Mikeys Late Night Slice 6562 Riverside Drive Dublin",
        "Muster 1:00",
        "Chalk talk: 1:45",
        "Pack Away: 2:00",
        "Shiggy: 2 (out of 5)",
        "Hash Cash: $8.00",
        "Trail: A to A*",
      ].join("\n");

      const result = parseEventDetails(text);
      expect(result.hares).toBe("Can't feel Clap... Saran Clap and Can't Feel It");
      expect(result.location).toBe("Meet at Mikeys Late Night Slice 6562 Riverside Drive Dublin");
      expect(result.locationUrl).toContain("google.com/maps");
      expect(result.startTime).toBe("14:00"); // "2:00" → afternoon
    });

    it("uses chalk talk as fallback time", () => {
      const text = "Chalk talk: 1:45\nWhere: Somewhere";
      const result = parseEventDetails(text);
      expect(result.startTime).toBe("13:45");
    });

    it("handles empty detail text", () => {
      const result = parseEventDetails("");
      expect(result.hares).toBeUndefined();
      expect(result.location).toBeUndefined();
      expect(result.startTime).toBeUndefined();
    });

    it("strips TBA placeholder from location", () => {
      const text = "Where: TBA";
      const result = parseEventDetails(text);
      expect(result.location).toBeUndefined();
    });

    it("collects non-field lines as description", () => {
      const text = "Shiggy: 3/5\nHash Cash: $8.00\nBring your whistle";
      const result = parseEventDetails(text);
      expect(result.description).toContain("Shiggy: 3/5");
      expect(result.description).toContain("Hash Cash: $8.00");
    });
  });
});
