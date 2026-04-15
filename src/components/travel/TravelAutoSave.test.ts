import { describe, it, expect } from "vitest";
import { TravelAutoSave } from "./TravelAutoSave";

describe("TravelAutoSave", () => {
  it("exports TravelAutoSave as a function", () => {
    expect(typeof TravelAutoSave).toBe("function");
  });
});
