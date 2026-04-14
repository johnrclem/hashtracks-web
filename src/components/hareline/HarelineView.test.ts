import { computeInitialScope } from "./HarelineView";

describe("computeInitialScope", () => {
  test("explicit scope=my wins even with regions present", () => {
    expect(computeInitialScope("my", "Boston, MA", "all")).toBe("my");
  });

  test("explicit scope=all wins", () => {
    expect(computeInitialScope("all", null, "my")).toBe("all");
  });

  test("regions present with no explicit scope → always returns all", () => {
    expect(computeInitialScope(null, "Boston, MA", "my")).toBe("all");
  });

  test("pipe-separated multi-region with no explicit scope → all", () => {
    expect(computeInitialScope(null, "Boston, MA|NYC", "my")).toBe("all");
  });

  test("no regions and no explicit scope → uses defaultScope (my)", () => {
    expect(computeInitialScope(null, null, "my")).toBe("my");
  });

  test("no regions and no explicit scope → uses defaultScope (all)", () => {
    expect(computeInitialScope(null, null, "all")).toBe("all");
  });

  test("empty string regions → uses defaultScope", () => {
    expect(computeInitialScope(null, "", "my")).toBe("my");
  });

  test("invalid scope param is ignored → falls through to region check", () => {
    // 'mine' is not a valid scope value, so falls through to region check
    expect(computeInitialScope("mine", "Boston, MA", "my")).toBe("all");
  });
});
