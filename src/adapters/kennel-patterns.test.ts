import { describe, it, expect } from "vitest";
import { matchKennelPatterns, type KennelPattern } from "./kennel-patterns";

describe("matchKennelPatterns (#1023 step 4)", () => {
  describe("legacy string-only configs (no behavior change)", () => {
    it("returns [firstMatch] for first matching string pattern", () => {
      const patterns: KennelPattern[] = [
        ["^Cherry City", "cch3-or"],
        ["^OH3", "oh3"],
      ];
      expect(matchKennelPatterns("OH3 #1340", patterns)).toEqual(["oh3"]);
    });

    it("preserves first-match-wins ordering for overlapping single-tag patterns", () => {
      // Mirrors the C2B3H4-vs-CH3 case in prisma/seed-data/sources.ts:296-299:
      // a more specific kennel must come before a generic one.
      const patterns: KennelPattern[] = [
        ["C2B3H4", "c2b3h4"],
        ["CH3", "ch3"],
      ];
      // Both patterns match this title; the first wins.
      expect(matchKennelPatterns("C2B3H4 Special Run", patterns)).toEqual(["c2b3h4"]);
      // Only the second matches this title.
      expect(matchKennelPatterns("CH3 Tuesday", patterns)).toEqual(["ch3"]);
    });

    it("returns [] when no pattern matches", () => {
      const patterns: KennelPattern[] = [["foo", "x"]];
      expect(matchKennelPatterns("bar baz", patterns)).toEqual([]);
    });

    it("is case-insensitive", () => {
      expect(matchKennelPatterns("oh3", [["^OH3", "oh3"]])).toEqual(["oh3"]);
    });

    it("skips malformed regex strings without throwing", () => {
      const patterns: KennelPattern[] = [
        ["[invalid(", "broken"],
        ["valid", "good"],
      ];
      expect(matchKennelPatterns("valid input", patterns)).toEqual(["good"]);
    });

    it("returns [] for empty patterns", () => {
      expect(matchKennelPatterns("anything", [])).toEqual([]);
    });
  });

  describe("multi-kennel array patterns", () => {
    it("returns the array contents when a single array pattern matches", () => {
      const patterns: KennelPattern[] = [
        ["Cherry City.*OH3|OH3.*Cherry City", ["cch3-or", "oh3"]],
      ];
      expect(matchKennelPatterns("Cherry City H3 #1 / OH3 # 1340", patterns))
        .toEqual(["cch3-or", "oh3"]);
    });

    it("unions multiple matching array patterns deduplicated", () => {
      const patterns: KennelPattern[] = [
        ["Cherry City", ["cch3-or"]],
        ["OH3", ["oh3", "cch3-or"]],
      ];
      // Both match; union = first-seen order
      expect(matchKennelPatterns("Cherry City + OH3 trail", patterns))
        .toEqual(["cch3-or", "oh3"]);
    });
  });

  describe("mixed string + array patterns (precedence)", () => {
    it("array match takes precedence — string match captured but discarded", () => {
      const patterns: KennelPattern[] = [
        ["^OH3", "oh3"], // string pattern matches first
        ["Cherry City|OH3", ["cch3-or", "oh3"]], // array pattern matches too
      ];
      // String "oh3" was captured first, but array fires → array wins
      expect(matchKennelPatterns("OH3 #1340", patterns))
        .toEqual(["cch3-or", "oh3"]);
    });

    it("string match returns only when no array pattern fires", () => {
      const patterns: KennelPattern[] = [
        ["Cherry City.*OH3", ["cch3-or", "oh3"]], // array — doesn't match
        ["^OH3", "oh3"], // string — matches
      ];
      expect(matchKennelPatterns("OH3 standalone", patterns)).toEqual(["oh3"]);
    });

    it("string match after an array match is ignored entirely", () => {
      const patterns: KennelPattern[] = [
        ["A", ["a-multi"]], // array fires
        ["foo", "single-tag"], // string also fires — but array already won
      ];
      expect(matchKennelPatterns("A foo bar", patterns)).toEqual(["a-multi"]);
    });
  });
});
