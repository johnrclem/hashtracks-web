import { extractCoordsFromMapsUrl, getEventCoords, getRegionColor, DEFAULT_PIN_COLOR } from "./geo";

describe("extractCoordsFromMapsUrl", () => {
  it("parses @lat,lng,zoom path segment", () => {
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/place/Inwood+Hill+Park/@40.8698,-73.9299,17z",
    );
    expect(result).toEqual({ lat: 40.8698, lng: -73.9299 });
  });

  it("parses @lat,lng with no zoom", () => {
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/@51.5074,-0.1278",
    );
    expect(result).toEqual({ lat: 51.5074, lng: -0.1278 });
  });

  it("parses ?q=lat,lng query param with raw coords", () => {
    const result = extractCoordsFromMapsUrl(
      "https://maps.google.com/?q=40.748,-73.985",
    );
    expect(result).toEqual({ lat: 40.748, lng: -73.985 });
  });

  it("parses ll=lat,lng param (legacy format)", () => {
    const result = extractCoordsFromMapsUrl(
      "https://maps.google.com/maps?ll=40.748,-73.985",
    );
    expect(result).toEqual({ lat: 40.748, lng: -73.985 });
  });

  it("parses query=lat,lng param (used by adapter-generated URLs)", () => {
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/search/?api=1&query=40.748,-73.985",
    );
    expect(result).toEqual({ lat: 40.748, lng: -73.985 });
  });

  it("returns null for search-only URL with place name (non-numeric query)", () => {
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/search/?api=1&query=Inwood+Hill+Park",
    );
    expect(result).toBeNull();
  });

  it("returns null for out-of-range latitude (> 90)", () => {
    expect(
      extractCoordsFromMapsUrl("https://www.google.com/maps/@95.0,-73.985,17z"),
    ).toBeNull();
  });

  it("returns null for out-of-range longitude (> 180)", () => {
    expect(
      extractCoordsFromMapsUrl("https://www.google.com/maps/@40.748,185.0,17z"),
    ).toBeNull();
  });

  it("returns null for non-maps URL", () => {
    const result = extractCoordsFromMapsUrl("https://example.com/event/123");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractCoordsFromMapsUrl("")).toBeNull();
  });

  it("handles negative coordinates (southern hemisphere / western Europe)", () => {
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/place/Sydney/@-33.8688,151.2093,13z",
    );
    expect(result).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it("handles coordinates with many decimal places", () => {
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/@40.71427890,-74.00594510,16z",
    );
    expect(result?.lat).toBeCloseTo(40.7142789, 4);
    expect(result?.lng).toBeCloseTo(-74.0059451, 4);
  });

  it("returns null for malformed URL", () => {
    expect(extractCoordsFromMapsUrl("not-a-url")).toBeNull();
  });
});

describe("getEventCoords", () => {
  it("returns precise=true when lat/lng provided", () => {
    const result = getEventCoords(40.71, -74.01, "New York City, NY");
    expect(result).toEqual({ lat: 40.71, lng: -74.01, precise: true });
  });

  it("falls back to centroid when no coords and known region", () => {
    const result = getEventCoords(null, null, "New York City, NY");
    expect(result).not.toBeNull();
    expect(result?.precise).toBe(false);
    expect(result?.lat).toBeCloseTo(40.71, 1);
  });

  it("returns null when no coords and unknown region", () => {
    const result = getEventCoords(null, null, "Unknown Nowhere");
    expect(result).toBeNull();
  });

  it("handles undefined coords (treated as null)", () => {
    const result = getEventCoords(undefined, undefined, "Boston, MA");
    expect(result).not.toBeNull();
    expect(result?.precise).toBe(false);
  });
});

describe("getRegionColor", () => {
  it("returns a hex color for a known region", () => {
    const color = getRegionColor("New York City, NY");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(color).not.toBe(DEFAULT_PIN_COLOR);
  });

  it("returns DEFAULT_PIN_COLOR for an unknown region", () => {
    expect(getRegionColor("Unknown Nowhere")).toBe(DEFAULT_PIN_COLOR);
  });
});
