import { describe, expect, it } from "vitest";
import { toSlug } from "./seed-utils";
import { toSlug as kennelUtilsToSlug } from "../src/lib/kennel-utils";

describe("prisma/seed-utils.ts toSlug (#1422 regression guard)", () => {
  it("strips a literal '/' from the slug", () => {
    // Next.js treats "/" inside a route segment as a path separator and 404s
    // the page. The H2H3 / Cha-Am H3 record was unreachable for months because
    // toSlug() preserved the slash.
    expect(toSlug("H2H3 / Cha-Am H3")).toBe("h2h3-cha-am-h3");
    expect(toSlug("Foo/Bar H3")).toBe("foo-bar-h3");
  });

  it("collapses runs of mixed separators", () => {
    expect(toSlug("Cherry City & OH3")).toBe("cherry-city-oh3");
    expect(toSlug("Foo  Bar   H3")).toBe("foo-bar-h3");
    expect(toSlug("Foo--Bar")).toBe("foo-bar");
  });

  it("strips parens and trims edges", () => {
    expect(toSlug("Some (Kennel) H3")).toBe("some-kennel-h3");
    expect(toSlug(" leading and trailing ")).toBe("leading-and-trailing");
  });

  // The two toSlug() implementations (seed + admin flows) must stay aligned —
  // they're invoked from different code paths but produce slugs the same
  // routes consume. If they ever drift, the bug class re-opens.
  it.each([
    ["H2H3 / Cha-Am H3", "h2h3-cha-am-h3"],
    ["Foo/Bar H3", "foo-bar-h3"],
    ["Cherry City & OH3", "cherry-city-oh3"],
    ["Some (Kennel) H3", "some-kennel-h3"],
  ])("matches src/lib/kennel-utils.toSlug for %s", (input, expected) => {
    expect(toSlug(input)).toBe(expected);
    expect(kennelUtilsToSlug(input)).toBe(expected);
  });
});
