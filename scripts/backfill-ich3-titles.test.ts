import { describe, it, expect } from "vitest";
import { parseIch3LeakedTitle } from "./backfill-ich3-titles";

describe("parseIch3LeakedTitle (#2160 historical retitle)", () => {
  it("parses the canonical leaked shape 'ICH3# 60 Plea Barkin'", () => {
    expect(parseIch3LeakedTitle("ICH3# 60 Plea Barkin")).toEqual({ runNumber: 60, hares: "Plea Barkin" });
  });

  it("parses the spaced 'ICH3 #60 Plea Barkin' variant", () => {
    expect(parseIch3LeakedTitle("ICH3 #60 Plea Barkin")).toEqual({ runNumber: 60, hares: "Plea Barkin" });
  });

  it("is case-insensitive and trims", () => {
    expect(parseIch3LeakedTitle("  ich3# 59 Two Hares  ")).toEqual({ runNumber: 59, hares: "Two Hares" });
  });

  it("returns null for a title with no run-marker prefix (themed, leave untouched)", () => {
    expect(parseIch3LeakedTitle("Red Dress Run")).toBeNull();
  });

  it("returns null for an already-synthesized default title", () => {
    expect(parseIch3LeakedTitle("Iron City H3 Trail #60")).toBeNull();
  });

  it("returns null when there is a run number but no hare", () => {
    expect(parseIch3LeakedTitle("ICH3# 60")).toBeNull();
  });

  it("does not match a different kennel's title", () => {
    expect(parseIch3LeakedTitle("RICH3# 60 Someone")).toBeNull();
  });
});
