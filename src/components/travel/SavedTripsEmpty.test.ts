import { describe, it, expect } from "vitest";
import { SavedTripsEmpty } from "./SavedTripsEmpty";

describe("SavedTripsEmpty", () => {
  it("exports SavedTripsEmpty as a function", () => {
    expect(typeof SavedTripsEmpty).toBe("function");
  });
});
