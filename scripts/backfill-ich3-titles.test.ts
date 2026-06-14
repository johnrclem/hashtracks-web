import { describe, it, expect } from "vitest";
import { stripIch3TitlePrefix } from "./backfill-ich3-titles";

describe("stripIch3TitlePrefix (#2160 follow-up — title prefix only, never hares)", () => {
  it("strips the 'ICH3# 60' prefix, keeping a hare-name remainder as the title", () => {
    expect(stripIch3TitlePrefix("ICH3# 60 Plea Barkin")).toBe("Plea Barkin");
  });

  it("strips the prefix from a theme title without corrupting it", () => {
    expect(stripIch3TitlePrefix("ICH3#45 Dancin' the Night Away")).toBe("Dancin' the Night Away");
  });

  it("strips a 'ICH3 #40 - ' prefix with a dash connector", () => {
    expect(stripIch3TitlePrefix("ICH3 #40 - Forty's and Shorty's")).toBe("Forty's and Shorty's");
  });

  it("leaves an emoji-decorated title untouched (prefix not at the start)", () => {
    expect(stripIch3TitlePrefix("☠️ ICH3 #57: “Manhole’s Malicious March” ☠️")).toBeNull();
  });

  it("leaves the IC-Lite sub-series untouched", () => {
    expect(stripIch3TitlePrefix("IC-Lite#25")).toBeNull();
    expect(stripIch3TitlePrefix("ICLiteH3 #17")).toBeNull();
  });

  it("returns null when stripping would leave nothing", () => {
    expect(stripIch3TitlePrefix("ICH3#42")).toBeNull();
  });

  it("returns null for a title with no ICH3 prefix", () => {
    expect(stripIch3TitlePrefix("Sticky's Superbowl Surprise")).toBeNull();
  });
});
