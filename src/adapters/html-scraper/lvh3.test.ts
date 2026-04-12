import { resolveKennelTag, extractLvRunNumber } from "./lvh3";

describe("resolveKennelTag", () => {
  const patterns: [string, string][] = [
    ["lvhhh", "lv-h3"],
    ["assh3", "ass-h3"],
  ];

  it("matches LVHHH category to lv-h3", () => {
    expect(resolveKennelTag(["LVHHH", "Trails"], patterns, "lv-h3")).toBe("lv-h3");
  });

  it("matches ASSH3 category to ass-h3", () => {
    expect(resolveKennelTag(["ASSH3", "Trails"], patterns, "lv-h3")).toBe("ass-h3");
  });

  it("case-insensitive matching", () => {
    expect(resolveKennelTag(["Assh3"], patterns, "lv-h3")).toBe("ass-h3");
  });

  it("returns null when no category matches and default is null", () => {
    expect(resolveKennelTag(["RPHHH"], patterns, null)).toBeNull();
  });

  it("returns null on empty categories with null default", () => {
    expect(resolveKennelTag([], patterns, null)).toBeNull();
  });

  it("falls back to string default when provided", () => {
    expect(resolveKennelTag(["RPHHH"], patterns, "lv-h3")).toBe("lv-h3");
  });
});

describe("extractLvRunNumber", () => {
  it("extracts from '#1748 Boys Gone wild'", () => {
    expect(extractLvRunNumber("#1748 Boys Gone wild")).toBe(1748);
  });

  it("extracts from 'ASSH3 Pub Crawl – green mess weekend'", () => {
    expect(extractLvRunNumber("ASSH3 Pub Crawl – green mess weekend")).toBeUndefined();
  });

  it("extracts from 'Trail# 27'", () => {
    expect(extractLvRunNumber("Rat Pack# 27 – Year of the horse")).toBe(27);
  });

  it("returns undefined for plain text", () => {
    expect(extractLvRunNumber("Green Mess Weekend")).toBeUndefined();
  });
});
