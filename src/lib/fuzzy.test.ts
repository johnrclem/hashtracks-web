import { describe, it, expect } from "vitest";
import { fuzzyNameMatch, fuzzyMatch, type FuzzyCandidate } from "./fuzzy";

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

describe("fuzzyMatch containsBoost minimum length guard", () => {
  const candidates: FuzzyCandidate[] = [
    { id: "dch4", shortName: "DCH4", fullName: "DC Hash Four", aliases: [] },
    { id: "ch3", shortName: "CH3", fullName: "Chicago Hash House Harriers", aliases: [] },
    { id: "bh3", shortName: "BH3", fullName: "Boston Hash", aliases: ["Boston H3"] },
    { id: "bfm", shortName: "BFM", fullName: "Ben Franklin Mob", aliases: ["BFMH3"] },
    { id: "brooklyn", shortName: "Brooklyn H3", fullName: "Brooklyn Hash House Harriers", aliases: [] },
  ];

  it("short substring (3 chars inside 4 chars) does NOT get containsBoost", () => {
    // "CH4" is inside "DCH4" but at 3 chars, the boost should not apply
    const results = fuzzyMatch("CH4", candidates);
    const dch4 = results.find((r) => r.id === "dch4");
    // Without the boost, "CH4" vs "DCH4" should score < 0.95
    expect(dch4).toBeDefined();
    expect(dch4!.score).toBeLessThan(0.95);
  });

  it("short substring (3 chars inside 4 chars) — CH3 vs QCH3 should not be 1.0", () => {
    const qcCandidates: FuzzyCandidate[] = [
      { id: "qch3", shortName: "QCH3", fullName: "Quad Cities H3", aliases: [] },
    ];
    const results = fuzzyMatch("CH3", qcCandidates);
    const qch3 = results.find((r) => r.id === "qch3");
    // CH3 is inside QCH3 but too short for containsBoost
    expect(qch3).toBeDefined();
    expect(qch3!.score).toBeLessThan(0.95);
  });

  it("long substring (6+ chars) still gets containsBoost", () => {
    // "Brooklyn" (8 chars) inside "Brooklyn H3" (11 chars) — boost should apply
    const results = fuzzyMatch("Brooklyn", candidates);
    const brooklyn = results.find((r) => r.id === "brooklyn");
    expect(brooklyn).toBeDefined();
    expect(brooklyn!.score).toBeGreaterThan(0.8);
  });

  it("exact match still returns 1.0 regardless of length", () => {
    const results = fuzzyMatch("CH3", candidates);
    const ch3 = results.find((r) => r.id === "ch3");
    expect(ch3).toBeDefined();
    expect(ch3!.score).toBe(1);
  });

  it("BFMH3 alias should not boost SBFMH3 (5 chars inside 6 chars)", () => {
    const results = fuzzyMatch("SBFMH3", candidates);
    const bfm = results.find((r) => r.id === "bfm");
    // BFMH3 (5 chars) inside SBFMH3 — shorter string < 6, no boost
    expect(bfm).toBeDefined();
    expect(bfm!.score).toBeLessThan(0.95);
  });
});
