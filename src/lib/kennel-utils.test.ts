import { describe, expect, it } from "vitest";
import { toSlug, toKennelCode, buildKennelIdentifiers } from "./kennel-utils";

describe("toSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(toSlug("NYC H3")).toBe("nyc-h3");
  });

  it("strips parentheses", () => {
    expect(toSlug("Some (Kennel) H3")).toBe("some-kennel-h3");
  });

  it("collapses multiple separators into a single hyphen", () => {
    expect(toSlug("Foo  Bar   H3")).toBe("foo-bar-h3");
    expect(toSlug("Foo--Bar")).toBe("foo-bar");
  });

  it("strips literal slashes — regression for #1422 (H2H3 / Cha-Am H3 → h2h3-cha-am-h3)", () => {
    // Next.js routes treat "/" as a path separator; the public kennel page returns
    // 404 if the slug contains one. The kennel utils helper is reached by admin
    // creation/update flows — keep it slash-safe so admins can't reintroduce the bug.
    expect(toSlug("H2H3 / Cha-Am H3")).toBe("h2h3-cha-am-h3");
    expect(toSlug("Foo/Bar H3")).toBe("foo-bar-h3");
  });

  it("handles ampersands and other non-alphanumeric characters", () => {
    expect(toSlug("Cherry City & OH3")).toBe("cherry-city-oh3");
    expect(toSlug("X H3 + Y H3")).toBe("x-h3-y-h3");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toSlug(" leading and trailing ")).toBe("leading-and-trailing");
    expect(toSlug("-foo-")).toBe("foo");
  });
});

describe("toKennelCode", () => {
  it("strips slashes and other non-alphanumeric characters", () => {
    expect(toKennelCode("H2H3 / Cha-Am H3")).toBe("h2h3-cha-am-h3");
  });
});

describe("buildKennelIdentifiers", () => {
  it("returns matching slug + kennelCode for slash-bearing shortNames", () => {
    expect(buildKennelIdentifiers("H2H3 / Cha-Am H3")).toEqual({
      slug: "h2h3-cha-am-h3",
      kennelCode: "h2h3-cha-am-h3",
    });
  });
});
