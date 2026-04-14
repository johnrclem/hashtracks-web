import { describe, it, expect } from "vitest";
import { SavedTripCard } from "./SavedTripCard";

describe("SavedTripCard", () => {
  it("exports SavedTripCard as a function", () => {
    expect(typeof SavedTripCard).toBe("function");
  });
});
