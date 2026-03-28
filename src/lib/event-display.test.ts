import { describe, it, expect } from "vitest";
import { getLocationDisplay } from "./event-display";

describe("getLocationDisplay", () => {
  it("returns name with city appended when city not in name", () => {
    expect(getLocationDisplay({
      locationName: "The Rusty Bucket",
      locationCity: "Boston, MA",
    })).toBe("The Rusty Bucket, Boston, MA");
  });

  it("does not append city when city name is already in location", () => {
    expect(getLocationDisplay({
      locationName: "Central Park, Boston",
      locationCity: "Boston, MA",
    })).toBe("Central Park, Boston");
  });

  it("does not append city when full city+state is already in location", () => {
    expect(getLocationDisplay({
      locationName: "123 Main St, Boston, MA",
      locationCity: "Boston, MA",
    })).toBe("123 Main St, Boston, MA");
  });

  it("does not append city when location ends with US state abbreviation", () => {
    expect(getLocationDisplay({
      locationName: "13480 Congress Lake Avenue, Hartville, OH",
      locationCity: "Akron, OH",
    })).toBe("13480 Congress Lake Avenue, Hartville, OH");
  });

  it("does not append city when location ends with state + zip", () => {
    expect(getLocationDisplay({
      locationName: "1776 Memorial Park, Friendswood, TX 77546",
      locationCity: "Houston, TX",
    })).toBe("1776 Memorial Park, Friendswood, TX 77546");
  });

  it("does not append city when location ends with state + zip+4", () => {
    expect(getLocationDisplay({
      locationName: "100 Broadway, New York, NY 10001-1234",
      locationCity: "Manhattan, NY",
    })).toBe("100 Broadway, New York, NY 10001-1234");
  });

  it("still appends city when location has no state (venue name only)", () => {
    expect(getLocationDisplay({
      locationName: "The Pub on Main",
      locationCity: "Akron, OH",
    })).toBe("The Pub on Main, Akron, OH");
  });

  it("returns city when name is null", () => {
    expect(getLocationDisplay({
      locationName: null,
      locationCity: "Boston, MA",
    })).toBe("Boston, MA");
  });

  it("returns name when city is null", () => {
    expect(getLocationDisplay({
      locationName: "The Pub",
      locationCity: null,
    })).toBe("The Pub");
  });

  it("returns null when both are null", () => {
    expect(getLocationDisplay({
      locationName: null,
      locationCity: null,
    })).toBeNull();
  });
});
