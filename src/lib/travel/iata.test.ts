import { describe, it, expect } from "vitest";
import { resolveRefCode } from "./iata";

describe("resolveRefCode", () => {
  it("returns em-dash for empty, null, or undefined input", () => {
    expect(resolveRefCode("")).toBe("—");
    expect(resolveRefCode(null)).toBe("—");
    expect(resolveRefCode(undefined)).toBe("—");
    expect(resolveRefCode("   ")).toBe("—");
  });

  it("resolves curated destinations to their IATA codes", () => {
    expect(resolveRefCode("Washington, DC, USA")).toBe("DCA");
    expect(resolveRefCode("London, UK")).toBe("LHR");
    expect(resolveRefCode("Bangkok, Thailand")).toBe("BKK");
    expect(resolveRefCode("New York, NY, USA")).toBe("NYC");
    expect(resolveRefCode("San Francisco, CA, USA")).toBe("SFO");
    expect(resolveRefCode("Singapore")).toBe("SIN");
    expect(resolveRefCode("Berlin, Germany")).toBe("BER");
    expect(resolveRefCode("Tokyo, Japan")).toBe("HND");
  });

  it("resolves common US metros via the fallback table", () => {
    expect(resolveRefCode("Boston, MA, USA")).toBe("BOS");
    expect(resolveRefCode("Chicago, IL")).toBe("ORD");
    expect(resolveRefCode("Los Angeles, CA")).toBe("LAX");
    expect(resolveRefCode("Seattle")).toBe("SEA");
  });

  it("resolves international metros", () => {
    expect(resolveRefCode("Paris, France")).toBe("CDG");
    expect(resolveRefCode("Hong Kong")).toBe("HKG");
    expect(resolveRefCode("Toronto, Canada")).toBe("YYZ");
  });

  it("is case-insensitive for lookups", () => {
    expect(resolveRefCode("BOSTON, MA")).toBe("BOS");
    expect(resolveRefCode("new york, ny")).toBe("NYC");
  });

  it("uses the first comma-separated segment (strips state/country suffix)", () => {
    expect(resolveRefCode("San Diego, California, United States")).toBe("SAN");
  });

  it("falls back to first 3 chars for unknown cities", () => {
    expect(resolveRefCode("Kalamazoo, MI")).toBe("KAL");
    expect(resolveRefCode("Reykjavik, Iceland")).toBe("REY");
  });

  it("strips non-alphanumeric chars in the fallback", () => {
    expect(resolveRefCode("St. Louis, MO")).toBe("STL");
  });

  it("returns em-dash when the city slug has zero alphanumeric chars", () => {
    expect(resolveRefCode("...")).toBe("—");
    expect(resolveRefCode(",,,")).toBe("—");
  });
});
