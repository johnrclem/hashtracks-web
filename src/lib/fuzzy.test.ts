import { describe, it, expect } from "vitest";
import { fuzzyNameMatch, fuzzyMatch } from "./fuzzy";

describe("fuzzyNameMatch", () => {
  it("returns 1 for exact match", () => {
    expect(fuzzyNameMatch("Mudflap", "Mudflap")).toBe(1);
  });

  it("returns 1 for case-insensitive match", () => {
    expect(fuzzyNameMatch("Mudflap", "mudflap")).toBe(1);
    expect(fuzzyNameMatch("MUDFLAP", "mudflap")).toBe(1);
  });

  it("returns 1 for match with whitespace differences", () => {
    expect(fuzzyNameMatch("  Mudflap  ", "Mudflap")).toBe(1);
  });

  it("returns high score for close names", () => {
    const score = fuzzyNameMatch("Mudflap", "Mudflep");
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns low score for very different names", () => {
    const score = fuzzyNameMatch("Mudflap", "Zephyr");
    expect(score).toBeLessThan(0.4);
  });

  it("returns 0 when either string is empty", () => {
    expect(fuzzyNameMatch("", "Mudflap")).toBe(0);
    expect(fuzzyNameMatch("Mudflap", "")).toBe(0);
    expect(fuzzyNameMatch("", "")).toBe(0);
  });

  it("returns 0 for whitespace-only input", () => {
    expect(fuzzyNameMatch("   ", "Mudflap")).toBe(0);
    expect(fuzzyNameMatch("Mudflap", "   ")).toBe(0);
  });
});
