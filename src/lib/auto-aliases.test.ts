import { generateAliases } from "./auto-aliases";

describe("generateAliases", () => {
  // --- Edge cases ---

  it("returns empty array for empty inputs", () => {
    expect(generateAliases("", "")).toEqual([]);
  });

  it("returns empty array for whitespace-only inputs", () => {
    expect(generateAliases("  ", "   ")).toEqual([]);
  });

  // --- Exclusion rules ---

  it("excludes shortName from results", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases.map((a) => a.toLowerCase())).not.toContain("ebh3");
  });

  it("excludes fullName from results", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases.map((a) => a.toLowerCase())).not.toContain("east bay hash house harriers");
  });

  // --- Single-letter base guard ---

  it("does not generate single-letter aliases from short names like CH3", () => {
    const aliases = generateAliases("CH3", "Chicago Hash House Harriers");
    expect(aliases).not.toContain("C");
    expect(aliases).not.toContain("C Hash");
    expect(aliases).not.toContain("C H3");
  });

  it("does not generate single-letter aliases from short names like EH3", () => {
    const aliases = generateAliases("EH3", "Enfield Hash House Harriers");
    expect(aliases).not.toContain("E");
    expect(aliases).not.toContain("E Hash");
    expect(aliases).not.toContain("E H3");
  });

  // --- Deduplication ---

  it("does not return duplicate aliases (case-insensitive)", () => {
    const aliases = generateAliases("CH3", "Chicago Hash House Harriers");
    const lowerSet = new Set(aliases.map((a) => a.toLowerCase()));
    expect(lowerSet.size).toBe(aliases.length);
  });

  // --- Base name extraction ---

  it("strips Hash House Harriers to get base name", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases).toContain("East Bay");
  });

  it("strips H3 suffix from fullName", () => {
    const aliases = generateAliases("BFM", "Ben Franklin Mob H3");
    expect(aliases).toContain("Ben Franklin Mob");
  });

  // --- Abbreviation generation ---

  it("generates abbreviation from fullName words", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    // "East Bay" → "EB", plus "EBH3" variant (but EBH3 is shortName, so just "EB")
    expect(aliases).toContain("EB");
  });

  it("generates abbreviation for multi-word names", () => {
    const aliases = generateAliases("BFM", "Ben Franklin Mob H3");
    // BFM is shortName so excluded from results
    expect(aliases.map((a) => a.toLowerCase())).not.toContain("bfm");
    // But abbreviation + H3 variant should be generated
    expect(aliases).toContain("BFMH3");
  });

  it("skips abbreviation for single-word base names", () => {
    const aliases = generateAliases("Rumson", "Rumson Hash House Harriers");
    // Single word "Rumson" → no abbreviation (would be just "R")
    const singleLetterAliases = aliases.filter((a) => /^[A-Z]$/.test(a));
    expect(singleLetterAliases).toHaveLength(0);
  });

  // --- H3/Hash variants ---

  it("generates Hash and H3 variants of base name", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases).toContain("East Bay Hash");
    expect(aliases).toContain("East Bay H3");
  });

  it("generates variants for Chicago kennels", () => {
    const aliases = generateAliases("CH3", "Chicago Hash House Harriers");
    expect(aliases).toContain("Chicago");
    expect(aliases).toContain("Chicago Hash");
    expect(aliases).toContain("Chicago H3");
  });

  // --- ShortName-based variants ---

  it("splits shortName ending in H3 into base + variants", () => {
    const aliases = generateAliases("SFH3", "San Francisco Hash House Harriers");
    expect(aliases).toContain("SF");
    expect(aliases).toContain("SF Hash");
    expect(aliases).toContain("SF H3");
  });

  it("handles shortName ending in H4", () => {
    const aliases = generateAliases("DCH4", "DC Harriettes and Harriers Hash House");
    expect(aliases).toContain("DC");
    expect(aliases).toContain("DC Hash");
    expect(aliases).toContain("DC H4");
  });

  it("handles shortName ending in HHH", () => {
    const aliases = generateAliases("RumsonHHH", "Rumson Hash House Harriers");
    expect(aliases).toContain("RumsonH3");
    expect(aliases).toContain("Rumson H3");
  });

  // --- Geographic abbreviations ---

  it("generates NYC aliases for New York kennels", () => {
    const aliases = generateAliases("NYCH3", "New York City Hash House Harriers");
    expect(aliases).toContain("NYC");
    expect(aliases).toContain("NYC Hash");
    expect(aliases).toContain("NYC H3");
  });

  it("generates SF aliases for San Francisco kennels", () => {
    const aliases = generateAliases("SFH3", "San Francisco Hash House Harriers");
    expect(aliases).toContain("SF");
    expect(aliases).toContain("SF Hash");
    expect(aliases).toContain("SF H3");
  });

  it("generates DC aliases for Washington DC kennels", () => {
    const aliases = generateAliases("DCH3", "DC Hash House Harriers");
    expect(aliases).toContain("DC");
  });

  it("generates LI aliases for Long Island kennels", () => {
    const aliases = generateAliases("LIL", "Long Island Lunatics Hash House Harriers");
    expect(aliases).toContain("LI");
    expect(aliases).toContain("LI Hash");
    expect(aliases).toContain("LI H3");
  });

  // --- "The" prefix handling ---

  it("generates variant without 'The' prefix", () => {
    const aliases = generateAliases("BMH3", "The Greatest Hash");
    expect(aliases).toContain("Greatest");
  });

  // --- Known kennel patterns from seed.ts ---

  it("handles Brooklyn H3 pattern", () => {
    const aliases = generateAliases("BrH3", "Brooklyn Hash House Harriers");
    expect(aliases).toContain("Brooklyn");
    expect(aliases).toContain("Brooklyn Hash");
    expect(aliases).toContain("Brooklyn H3");
  });

  it("handles London H3 pattern", () => {
    const aliases = generateAliases("LH3", "London Hash House Harriers");
    expect(aliases).toContain("London");
    expect(aliases).toContain("London Hash");
    expect(aliases).toContain("London H3");
  });

  it("handles Enfield H3 (simple pattern)", () => {
    const aliases = generateAliases("EH3", "Enfield Hash House Harriers");
    expect(aliases).toContain("Enfield");
    expect(aliases).toContain("Enfield Hash");
    expect(aliases).toContain("Enfield H3");
  });

  it("handles West London pattern", () => {
    const aliases = generateAliases("WLH3", "West London Hash House Harriers");
    expect(aliases).toContain("West London");
    expect(aliases).toContain("West London Hash");
    expect(aliases).toContain("West London H3");
    expect(aliases).toContain("WL");
  });

  it("handles Charm City pattern", () => {
    const aliases = generateAliases("CCH3", "Charm City Hash House Harriers");
    expect(aliases).toContain("Charm City");
    expect(aliases).toContain("Charm City Hash");
    expect(aliases).toContain("Charm City H3");
  });

  // --- Reasonable output size ---

  it("returns a reasonable number of aliases (3-10)", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases.length).toBeGreaterThanOrEqual(3);
    expect(aliases.length).toBeLessThanOrEqual(10);
  });

  it("returns aliases for shortName-only input", () => {
    const aliases = generateAliases("BFM", "");
    // Not much to generate from shortName alone, but should not crash
    expect(Array.isArray(aliases)).toBe(true);
  });

  it("returns aliases for fullName-only input", () => {
    const aliases = generateAliases("", "East Bay Hash House Harriers");
    expect(aliases).toContain("East Bay");
    expect(aliases).toContain("East Bay Hash");
  });

  // --- No hash suffix in name ---

  it("handles kennel names without hash suffixes", () => {
    const aliases = generateAliases("BFM", "Ben Franklin Mob");
    // BFM is shortName (excluded), Ben Franklin Mob is fullName (excluded)
    // Should still generate abbreviation variants
    expect(aliases).toContain("BFMH3");
    expect(aliases).toContain("Ben Franklin Mob Hash");
    expect(aliases).toContain("Ben Franklin Mob H3");
  });
});
