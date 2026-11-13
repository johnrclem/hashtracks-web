import { describe, it, expect } from "vitest";
import { getFullLocationDisplay, getLocationDisplay } from "./event-display";

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

describe("getLocationDisplay — full international address (#2815)", () => {
  it("does not append a district after a complete address", () => {
    expect(getLocationDisplay({
      locationName: "Turning Wheels Craft Brewery, P. Almendras St, Cebu City, 6000 Cebu, Philippines",
      locationCity: "Mabolo, Central Visayas",
    })).toBe("Turning Wheels Craft Brewery, P. Almendras St, Cebu City, 6000 Cebu, Philippines");
  });
});

describe("getFullLocationDisplay", () => {
  const full = (locationName: string | null, locationStreet: string | null, locationCity: string | null = null) =>
    getFullLocationDisplay({ locationName, locationStreet, locationCity });

  it("puts the venue before a street line that omits it (#2859)", () => {
    expect(full("Fox and Duck", "Therfield, SG8 9PN")).toBe("Fox and Duck, Therfield, SG8 9PN");
  });

  it("shows the street alone when it already contains the venue", () => {
    expect(full("SRO Lounge", "SRO Lounge, 1807 Fifth Ave, San Diego, CA 92101"))
      .toBe("SRO Lounge, 1807 Fifth Ave, San Diego, CA 92101");
  });

  it("ignores case and punctuation when matching the venue in the street", () => {
    expect(full("St. Cloud", "4935 E Irlo Bronson Memorial Hwy, St Cloud, FL 34771"))
      .toBe("4935 E Irlo Bronson Memorial Hwy, St Cloud, FL 34771");
  });

  it("matches whole words only", () => {
    expect(full("Ely", "Elysian Fields, CB1 2PF")).toBe("Ely, Elysian Fields, CB1 2PF");
  });

  it("shows the venue alone when it already contains the street", () => {
    expect(full("Fox and Duck, Therfield, SG8 9PN", "Therfield, SG8 9PN", "Therfield, England"))
      .toBe("Fox and Duck, Therfield, SG8 9PN");
  });

  it("does not repeat an address-shaped venue name", () => {
    expect(full("850 Garfield Ave, Milford, OH 45150, USA", "840 Garfield Ave, Milford, OH 45150, USA"))
      .toBe("840 Garfield Ave, Milford, OH 45150, USA");
  });

  it("strips URLs from the venue name", () => {
    expect(full("The Pub https://maps.app.goo.gl/abc", "1 High St")).toBe("The Pub, 1 High St");
  });

  it("falls back to name and city when there is no street", () => {
    expect(full("The Rusty Bucket", null, "Boston, MA")).toBe("The Rusty Bucket, Boston, MA");
    expect(full("The Rusty Bucket", "   ", "Boston, MA")).toBe("The Rusty Bucket, Boston, MA");
  });

  it("shows the street when there is no venue name", () => {
    expect(full(null, "1 High St")).toBe("1 High St");
  });
});
