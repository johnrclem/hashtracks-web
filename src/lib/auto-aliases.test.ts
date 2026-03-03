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

  it.each([
    ["CH3", "Chicago Hash House Harriers", ["C", "C Hash", "C H3"]],
    ["EH3", "Enfield Hash House Harriers", ["E", "E Hash", "E H3"]],
  ])("does not generate single-letter aliases from %s", (shortName, fullName, forbidden) => {
    const aliases = generateAliases(shortName, fullName);
    for (const f of forbidden) {
      expect(aliases).not.toContain(f);
    }
  });

  // --- Deduplication ---

  it("does not return duplicate aliases (case-insensitive)", () => {
    const aliases = generateAliases("CH3", "Chicago Hash House Harriers");
    const lowerSet = new Set(aliases.map((a) => a.toLowerCase()));
    expect(lowerSet.size).toBe(aliases.length);
  });

  // --- Base name extraction ---

  it.each([
    ["EBH3", "East Bay Hash House Harriers", "East Bay"],
    ["BFM", "Ben Franklin Mob H3", "Ben Franklin Mob"],
  ])("strips hash suffix from fullName (%s → %s)", (shortName, fullName, expected) => {
    expect(generateAliases(shortName, fullName)).toContain(expected);
  });

  // --- Abbreviation generation ---

  it("generates abbreviation from fullName words", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases).toContain("EB");
  });

  it("generates abbreviation+H3 for multi-word names", () => {
    const aliases = generateAliases("BFM", "Ben Franklin Mob H3");
    expect(aliases.map((a) => a.toLowerCase())).not.toContain("bfm");
    expect(aliases).toContain("BFMH3");
  });

  it("skips abbreviation for single-word base names", () => {
    const aliases = generateAliases("Rumson", "Rumson Hash House Harriers");
    const singleLetterAliases = aliases.filter((a) => /^[A-Z]$/.test(a));
    expect(singleLetterAliases).toHaveLength(0);
  });

  // --- H3/Hash variants + known kennel patterns ---

  it.each([
    ["EBH3", "East Bay Hash House Harriers", ["East Bay Hash", "East Bay H3"]],
    ["CH3", "Chicago Hash House Harriers", ["Chicago", "Chicago Hash", "Chicago H3"]],
    ["BrH3", "Brooklyn Hash House Harriers", ["Brooklyn", "Brooklyn Hash", "Brooklyn H3"]],
    ["LH3", "London Hash House Harriers", ["London", "London Hash", "London H3"]],
    ["EH3", "Enfield Hash House Harriers", ["Enfield", "Enfield Hash", "Enfield H3"]],
    ["CCH3", "Charm City Hash House Harriers", ["Charm City", "Charm City Hash", "Charm City H3"]],
    ["WLH3", "West London Hash House Harriers", ["West London", "West London Hash", "West London H3", "WL"]],
  ])("generates expected aliases for %s (%s)", (shortName, fullName, expected) => {
    const aliases = generateAliases(shortName, fullName);
    for (const e of expected) {
      expect(aliases).toContain(e);
    }
  });

  // --- ShortName-based variants ---

  it.each([
    ["SFH3", "San Francisco Hash House Harriers", ["SF", "SF Hash", "SF H3"]],
    ["DCH4", "DC Harriettes and Harriers Hash House", ["DC", "DC Hash", "DC H4"]],
    ["RumsonHHH", "Rumson Hash House Harriers", ["RumsonH3", "Rumson H3"]],
  ])("derives variants from shortName %s", (shortName, fullName, expected) => {
    const aliases = generateAliases(shortName, fullName);
    for (const e of expected) {
      expect(aliases).toContain(e);
    }
  });

  // --- Geographic abbreviations ---

  it.each([
    ["NYCH3", "New York City Hash House Harriers", ["NYC", "NYC Hash", "NYC H3"]],
    ["SFH3", "San Francisco Hash House Harriers", ["SF", "SF Hash", "SF H3"]],
    ["LIL", "Long Island Lunatics Hash House Harriers", ["LI", "LI Hash", "LI H3"]],
  ])("generates geo abbreviations for %s", (shortName, fullName, expected) => {
    const aliases = generateAliases(shortName, fullName);
    for (const e of expected) {
      expect(aliases).toContain(e);
    }
  });

  it("generates DC alias for Washington DC kennels", () => {
    const aliases = generateAliases("DCH3", "DC Hash House Harriers");
    expect(aliases).toContain("DC");
  });

  // --- "The" prefix handling ---

  it("generates variant without 'The' prefix", () => {
    const aliases = generateAliases("BMH3", "The Greatest Hash");
    expect(aliases).toContain("Greatest");
  });

  // --- Reasonable output size ---

  it("returns a reasonable number of aliases (3-10)", () => {
    const aliases = generateAliases("EBH3", "East Bay Hash House Harriers");
    expect(aliases.length).toBeGreaterThanOrEqual(3);
    expect(aliases.length).toBeLessThanOrEqual(10);
  });

  it("returns aliases for shortName-only input", () => {
    const aliases = generateAliases("BFM", "");
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
    expect(aliases).toContain("BFMH3");
    expect(aliases).toContain("Ben Franklin Mob Hash");
    expect(aliases).toContain("Ben Franklin Mob H3");
  });
});
