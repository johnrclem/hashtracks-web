import { describe, it, expect } from "vitest";
import { TravelResultFilters } from "./TravelResultFilters";

describe("TravelResultFilters", () => {
  it("exports TravelResultFilters as a function", () => {
    expect(typeof TravelResultFilters).toBe("function");
  });
});
