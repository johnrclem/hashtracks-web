import { describe, it, expect } from "vitest";
import { TravelResults } from "./TravelResults";

describe("TravelResults", () => {
  it("exports TravelResults as a function", () => {
    expect(typeof TravelResults).toBe("function");
  });
});
