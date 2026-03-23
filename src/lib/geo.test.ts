import { extractCoordsFromMapsUrl, getEventCoords, getRegionColor, DEFAULT_PIN_COLOR, haversineDistance, geocodeAddress, reverseGeocode, cityFromTimezone, resolveShortMapsUrl } from "./geo";

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

  it("rejects zeroed coordinates (0,0) as invalid sentinel", () => {
    expect(
      extractCoordsFromMapsUrl("https://maps.google.com/?q=0.00000000,0.00000000"),
    ).toBeNull();
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

describe("haversineDistance", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("computes NYC → London as ~5570 km (±5%)", () => {
    const dist = haversineDistance(40.7128, -74.006, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(5570 * 0.95);
    expect(dist).toBeLessThan(5570 * 1.05);
  });

  it("computes NYC → Brooklyn as ~5–8 km (short distance accuracy)", () => {
    const dist = haversineDistance(40.7128, -74.006, 40.7614, -73.9776);
    expect(dist).toBeGreaterThan(5);
    expect(dist).toBeLessThan(8);
  });

  it("handles southern hemisphere (negative latitudes)", () => {
    // Sydney → Melbourne ≈ 713 km
    const dist = haversineDistance(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(dist).toBeGreaterThan(713 * 0.95);
    expect(dist).toBeLessThan(713 * 1.05);
  });
});

describe("geocodeAddress", () => {
  const originalEnv = process.env.GOOGLE_CALENDAR_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env.GOOGLE_CALENDAR_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns coordinates for a successful geocode response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 40.748, lng: -73.985 } } }],
      }),
    } as Response);

    const result = await geocodeAddress("Empire State Building, New York");
    expect(result).toEqual({ lat: 40.748, lng: -73.985 });
  });

  it("returns null when API returns ZERO_RESULTS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    } as Response);

    const result = await geocodeAddress("xyznonexistentplace123");
    expect(result).toBeNull();
  });

  it("returns null when fetch fails (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const result = await geocodeAddress("Some Address");
    expect(result).toBeNull();
  });

  it("returns null when API key is missing", async () => {
    delete process.env.GOOGLE_CALENDAR_API_KEY;
    const result = await geocodeAddress("Some Address");
    expect(result).toBeNull();
  });

  it("returns null for empty address string", async () => {
    const result = await geocodeAddress("   ");
    expect(result).toBeNull();
  });

  it("returns null when HTTP response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await geocodeAddress("Some Address");
    expect(result).toBeNull();
  });

  it("passes an AbortSignal to fetch for timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 40.0, lng: -74.0 } } }],
      }),
    } as Response);

    await geocodeAddress("Test Address");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns null when fetch is aborted (timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const result = await geocodeAddress("Slow Address");
    expect(result).toBeNull();
  });

  it("passes language=en to Google Maps Geocoding API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 43.16, lng: -77.61 } } }],
      }),
    } as Response);
    await geocodeAddress("Rochester, NY");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("language=en");
  });
});

describe("reverseGeocode", () => {
  const originalEnv = process.env.GOOGLE_CALENDAR_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env.GOOGLE_CALENDAR_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns city and state from a successful reverse geocode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            address_components: [
              { long_name: "Brooklyn", short_name: "Brooklyn", types: ["sublocality"] },
              { long_name: "New York", short_name: "NY", types: ["administrative_area_level_1"] },
            ],
          },
        ],
      }),
    } as Response);

    const result = await reverseGeocode(40.6782, -73.9442);
    expect(result).toBe("Brooklyn, NY");
  });

  it("returns city only when no state component", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            address_components: [
              { long_name: "London", short_name: "London", types: ["locality"] },
            ],
          },
        ],
      }),
    } as Response);

    const result = await reverseGeocode(51.5074, -0.1278);
    expect(result).toBe("London");
  });

  it("returns null when API returns ZERO_RESULTS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    } as Response);

    const result = await reverseGeocode(0, 0);
    expect(result).toBeNull();
  });

  it("returns null when no locality component found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            address_components: [
              { long_name: "USA", short_name: "US", types: ["country"] },
            ],
          },
        ],
      }),
    } as Response);

    const result = await reverseGeocode(40, -74);
    expect(result).toBeNull();
  });

  it("returns null when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await reverseGeocode(40, -74);
    expect(result).toBeNull();
  });

  it("returns null when API key is missing", async () => {
    delete process.env.GOOGLE_CALENDAR_API_KEY;
    const result = await reverseGeocode(40, -74);
    expect(result).toBeNull();
  });

  it("passes language=en to Google Maps Geocoding API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            address_components: [
              { long_name: "Rochester", short_name: "Rochester", types: ["locality"] },
              { long_name: "New York", short_name: "NY", types: ["administrative_area_level_1"] },
            ],
          },
        ],
      }),
    } as Response);
    await reverseGeocode(43.16, -77.61);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("language=en");
  });
});

describe("cityFromTimezone", () => {
  it("extracts city from Strava timezone format", () => {
    expect(cityFromTimezone("(GMT-05:00) America/New_York")).toBe("New York");
  });

  it("extracts city from plain IANA timezone", () => {
    expect(cityFromTimezone("America/Los_Angeles")).toBe("Los Angeles");
  });

  it("handles multi-level timezone (e.g. America/Indiana/Indianapolis)", () => {
    expect(cityFromTimezone("America/Indiana/Indianapolis")).toBe("Indianapolis");
  });

  it("returns null for null input", () => {
    expect(cityFromTimezone(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(cityFromTimezone("")).toBeNull();
  });

  it("returns null for non-IANA format", () => {
    expect(cityFromTimezone("EST")).toBeNull();
  });
});

describe("resolveShortMapsUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves maps.app.goo.gl URL to full Google Maps URL", async () => {
    const fullUrl = "https://www.google.com/maps/place/Wide+Shut+Bar/@40.7223,-73.9912,17z";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      url: fullUrl,
    } as Response);

    const result = await resolveShortMapsUrl("https://maps.app.goo.gl/dCAkzG1FFFH3ApJF9");
    expect(result).toBe(fullUrl);
    expect(fetch).toHaveBeenCalledWith(
      "https://maps.app.goo.gl/dCAkzG1FFFH3ApJF9",
      expect.objectContaining({ method: "HEAD", redirect: "follow" }),
    );
  });

  it("resolves goo.gl/maps URL", async () => {
    const fullUrl = "https://www.google.com/maps/place/Test/@40.0,-74.0,17z";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      url: fullUrl,
    } as Response);

    const result = await resolveShortMapsUrl("https://goo.gl/maps/abc123");
    expect(result).toBe(fullUrl);
  });

  it("returns null for non-short-URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await resolveShortMapsUrl("https://www.google.com/maps/@40.0,-74.0,17z");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null for empty string", async () => {
    const result = await resolveShortMapsUrl("");
    expect(result).toBeNull();
  });

  it("returns null when redirect URL is same as input (no redirect)", async () => {
    const url = "https://maps.app.goo.gl/abc123";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      url: url,
    } as Response);

    const result = await resolveShortMapsUrl(url);
    expect(result).toBeNull();
  });

  it("returns null when fetch fails (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await resolveShortMapsUrl("https://maps.app.goo.gl/abc123");
    expect(result).toBeNull();
  });

  it("returns null when fetch is aborted (timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );
    const result = await resolveShortMapsUrl("https://maps.app.goo.gl/abc123");
    expect(result).toBeNull();
  });

  it("returns null for non-maps goo.gl URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await resolveShortMapsUrl("https://goo.gl/some-other-thing");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when redirect goes to non-Google domain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      url: "https://evil.example.com/phishing",
    } as Response);
    const result = await resolveShortMapsUrl("https://maps.app.goo.gl/abc123");
    expect(result).toBeNull();
  });
});

// ── parseDMSFromLocation ──

import { parseDMSFromLocation, stripDMSFromLocation } from "./geo";

describe("parseDMSFromLocation", () => {
  it("parses DMS coordinates from location string", () => {
    const result = parseDMSFromLocation('Fort Misery, 34°08\'52.8"N 112°22\'05.6"W, Yavapai County');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(34.1480, 3);
    expect(result!.lng).toBeCloseTo(-112.3682, 3);
  });

  it("returns null for location without DMS", () => {
    expect(parseDMSFromLocation("123 Main St, Phoenix, AZ")).toBeNull();
  });

  it("handles southern hemisphere", () => {
    const result = parseDMSFromLocation('33°51\'54.0"S 151°12\'36.0"E');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(-33.865, 2);
    expect(result!.lng).toBeCloseTo(151.21, 2);
  });
});

describe("stripDMSFromLocation", () => {
  it("strips DMS and cleans up commas", () => {
    const result = stripDMSFromLocation('Fort Misery, 34°08\'52.8"N 112°22\'05.6"W, Yavapai County, AZ');
    expect(result).toBe("Fort Misery, Yavapai County, AZ");
  });

  it("returns original when no DMS present", () => {
    expect(stripDMSFromLocation("123 Main St, Phoenix, AZ")).toBe("123 Main St, Phoenix, AZ");
  });
});
