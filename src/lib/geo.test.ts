import { extractCoordsFromMapsUrl, getEventCoords, getRegionColor, DEFAULT_PIN_COLOR, haversineDistance, geocodeAddress, boundingBoxFromCenter, boundingBoxForRadiusKm, GEOCODE_VIEWPORT_DELTA_DEG, reverseGeocode, cityFromTimezone, resolveShortMapsUrl, parseDMSFromLocation, stripDMSFromLocation, buildVenueGeocodeQueries, venueGeocodeRejection, geocodeVenue, type GeocodeResult } from "./geo";

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

  it("prefers !3d/!4d place coords over @lat,lng viewport center", () => {
    // Real Treadwell Park URL: @coords are viewport center (NJ), !3d/!4d are actual place pin (Manhattan)
    const result = extractCoordsFromMapsUrl(
      "https://www.google.com/maps/place/Treadwell+Park/@40.7103089,-74.3214601,11z/data=!3m1!5s0x89c25a1aa1867d57:0x95d67044228766f4!4m7!3m6!1s0x89c25a1075bc2e41:0x8975b784309ad2a1!8m2!3d40.7103089!4d-74.0165895",
    );
    expect(result).toEqual({ lat: 40.7103089, lng: -74.0165895 });
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

  it.each(["TBD", "tba", "TBD.", "TBA!", "TBA - Christmas Run", "?", "N/A", "See calendar details"])(
    "skips the API call for placeholder venue %j",
    async (address) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      expect(await geocodeAddress(address)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("still geocodes real venues whose name starts with a placeholder word", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 1, lng: 2 } } }],
      }),
    } as Response);
    expect(await geocodeAddress("TBD Brewing Co")).toEqual({ lat: 1, lng: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("logs ZERO_RESULTS as a warning but key/quota failures as errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "REQUEST_DENIED", error_message: "API key expired", results: [] }),
      } as Response);

    await geocodeAddress("Chez Crunchy");
    await geocodeAddress("Real Place");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ZERO_RESULTS"));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("REQUEST_DENIED"));
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

  it("appends &region= when regionBias option is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 39.28, lng: -77.86 } } }],
      }),
    } as Response);
    await geocodeAddress("Charlestown", { regionBias: "us" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("&region=us");
  });

  it("appends &bounds= (SW|NE viewport) when bounds option is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 38.9, lng: -77.0 } } }],
      }),
    } as Response);
    await geocodeAddress("Union Station", {
      bounds: { swLat: 38.4, swLng: -77.5, neLat: 39.4, neLng: -76.5 },
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("&bounds=38.4,-77.5|39.4,-76.5");
  });

  describe("boundingBoxFromCenter", () => {
    it("builds a symmetric SW|NE box around the center using the default delta", () => {
      expect(boundingBoxFromCenter(38.9, -77.0)).toEqual({
        swLat: 38.9 - GEOCODE_VIEWPORT_DELTA_DEG,
        swLng: -77.0 - GEOCODE_VIEWPORT_DELTA_DEG,
        neLat: 38.9 + GEOCODE_VIEWPORT_DELTA_DEG,
        neLng: -77.0 + GEOCODE_VIEWPORT_DELTA_DEG,
      });
    });

    it("honors an explicit half-width", () => {
      expect(boundingBoxFromCenter(10, 20, 1)).toEqual({
        swLat: 9, swLng: 19, neLat: 11, neLng: 21,
      });
    });

    it("returns undefined for non-finite inputs", () => {
      expect(boundingBoxFromCenter(Number.NaN, -77.0)).toBeUndefined();
      expect(boundingBoxFromCenter(38.9, Number.POSITIVE_INFINITY)).toBeUndefined();
      expect(boundingBoxFromCenter(38.9, -77.0, Number.NaN)).toBeUndefined();
    });

    it("clamps corners to valid lat/lng ranges near the poles/antimeridian", () => {
      expect(boundingBoxFromCenter(89.8, 179.8)).toEqual({
        swLat: 89.8 - GEOCODE_VIEWPORT_DELTA_DEG,
        swLng: 179.8 - GEOCODE_VIEWPORT_DELTA_DEG,
        neLat: 90,
        neLng: 180,
      });
    });
  });

  it("does not include &region= when no options provided (backward compatible)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 40.0, lng: -74.0 } } }],
      }),
    } as Response);
    await geocodeAddress("Some Address");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("&region=");
  });

  it("does not include &region= when regionBias is undefined", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 51.5, lng: -0.1 } } }],
      }),
    } as Response);
    await geocodeAddress("London", { regionBias: undefined });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("&region=");
  });

  it("passes gb region bias for UK kennels", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ geometry: { location: { lat: 51.5, lng: -0.1 } } }],
      }),
    } as Response);
    await geocodeAddress("Barnes", { regionBias: "gb" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("&region=gb");
  });
});

/** Build a Geocoding API address component. */
function comp(name: string, type: string, shortName = name) {
  return { long_name: name, short_name: shortName, types: [type, "political"] };
}

/** Queue one mocked Geocoding API JSON response per fetch call, in order. */
function mockGeocodeResponses(...bodies: unknown[]) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const body of bodies) {
    spy.mockResolvedValueOnce({ ok: true, json: async () => body } as Response);
  }
  return spy;
}

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

  it("returns null when both the town and the address lookups come back empty", async () => {
    const fetchSpy = mockGeocodeResponses(
      { status: "ZERO_RESULTS", results: [] },
      { status: "ZERO_RESULTS", results: [] },
    );

    expect(await reverseGeocode(0, 0)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns null when no address names a town", async () => {
    mockGeocodeResponses(
      { status: "OK", results: [{ address_components: [comp("USA", "country", "US")] }] },
      { status: "OK", results: [{ types: ["country"], address_components: [comp("USA", "country", "US")] }] },
    );

    expect(await reverseGeocode(40, -74)).toBeNull();
  });

  // #2860: Google has no locality-typed result for most English villages, so
  // the filtered lookup is empty even though the addresses name the village.
  it("falls back to the village an address names when the town lookup is empty", async () => {
    const fetchSpy = mockGeocodeResponses(
      { status: "ZERO_RESULTS", results: [] },
      {
        status: "OK",
        results: [
          { types: ["plus_code"], address_components: [comp("2W8W+W8", "plus_code"), comp("Royston", "postal_town")] },
          {
            types: ["premise", "street_address"],
            address_components: [
              comp("The Green", "premise"),
              comp("Therfield", "locality"),
              comp("Royston", "postal_town"),
              comp("England", "administrative_area_level_1"),
              comp("United Kingdom", "country", "GB"),
            ],
          },
        ],
      },
    );

    expect(await reverseGeocode(52.017349, -0.054246)).toBe("Therfield, England");
    expect(fetchSpy.mock.calls[0][0]).toContain("result_type=locality|sublocality");
    expect(fetchSpy.mock.calls[1][0]).not.toContain("result_type");
  });

  it("falls back to the postal town when no address names a locality", async () => {
    mockGeocodeResponses(
      { status: "ZERO_RESULTS", results: [] },
      {
        status: "OK",
        results: [{
          types: ["premise", "street_address"],
          address_components: [
            comp("Sandy Lane", "route"),
            comp("Cannock", "postal_town"),
            comp("England", "administrative_area_level_1"),
          ],
        }],
      },
    );

    expect(await reverseGeocode(52.6935, -2.0492)).toBe("Cannock, England");
  });

  it("does not retry after a key or quota error", async () => {
    const fetchSpy = mockGeocodeResponses({ status: "REQUEST_DENIED", results: [] });

    expect(await reverseGeocode(40, -74)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
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

  // #968: IE-only workaround — County Dublin's admin short_name is "D"
  // (Eircode prefix). Drop it for IE; preserve 1-char codes elsewhere.
  it.each([
    { case: "IE: drops 1-char admin", country: "IE", admin: "D", expected: "Dublin" },
    { case: "AR: preserves 1-char admin", country: "AR", admin: "B", expected: "Dublin, B" },
  ])("$case", async ({ country, admin, expected }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ address_components: [
          { long_name: "Dublin", short_name: "Dublin", types: ["locality"] },
          { long_name: "Admin", short_name: admin, types: ["administrative_area_level_1"] },
          { long_name: country, short_name: country, types: ["country"] },
        ] }],
      }),
    } as Response);
    expect(await reverseGeocode(0, 0)).toBe(expected);
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

describe("buildVenueGeocodeQueries", () => {
  it("geocodes the venue with its street line first, then the street line alone", () => {
    expect(buildVenueGeocodeQueries("Fox and Duck", "Therfield, SG8 9PN")).toEqual([
      "Fox and Duck, Therfield, SG8 9PN",
      "Therfield, SG8 9PN",
    ]);
  });

  it.each([
    { case: "no street", location: "Central Park", street: null, expected: ["Central Park"] },
    { case: "placeholder street", location: "The Lion Inn", street: "TBC", expected: ["The Lion Inn"] },
    { case: "placeholder venue", location: "TBD", street: "Sandy Ln, Cannock, WS11 1RF", expected: ["Sandy Ln, Cannock, WS11 1RF"] },
    { case: "street already holds the venue", location: "SRO Lounge", street: "SRO Lounge, 1807 Fifth Ave, San Diego, CA 92101", expected: ["SRO Lounge, 1807 Fifth Ave, San Diego, CA 92101"] },
    { case: "venue already holds the street", location: "Shed, Lode, CB25 9ET", street: "Lode, CB25 9ET", expected: ["Shed, Lode, CB25 9ET"] },
    { case: "nothing to geocode", location: "  ", street: undefined, expected: [] },
  ])("$case", ({ location, street, expected }) => {
    expect(buildVenueGeocodeQueries(location, street)).toEqual(expected);
  });
});

describe("venueGeocodeRejection", () => {
  const EXETER = { lat: 50.7184, lng: -3.5339 };
  const BEDFORD = { lat: 52.136, lng: -0.467 };

  // Real Geocoding API results captured 2026-11-12 (#2914, #2908, h5-gb finding).
  const wembdonHouse: GeocodeResult = {
    lat: 51.1342648,
    lng: -3.0250285,
    types: ["premise", "street_address"],
    components: [
      comp("Mt Radford", "premise"),
      comp("Wembdon Hill", "route"),
      comp("Wembdon", "locality"),
      comp("Bridgwater", "postal_town"),
      comp("Somerset", "administrative_area_level_2"),
      comp("England", "administrative_area_level_1"),
      comp("United Kingdom", "country", "GB"),
      comp("TA6 7PX", "postal_code"),
    ],
  };

  it("rejects a same-named place 58 km away in a town the venue doesn't name", () => {
    expect(venueGeocodeRejection(wembdonHouse, { location: "Mount Radford, Exeter" }, EXETER)).toMatch(
      /58km from the kennel and outside the town/,
    );
  });

  it("accepts a far result whose place the venue text leads with", () => {
    const jandaBaik: GeocodeResult = {
      lat: 3.341,
      lng: 101.84,
      types: ["establishment"],
      components: [comp("Kampung Janda Baik", "locality"), comp("Pahang", "administrative_area_level_1")],
    };
    expect(venueGeocodeRejection(jandaBaik, { location: "Janda Baik, Private Park" }, { lat: 3.1, lng: 101.6 })).toBeNull();
  });

  it("accepts a far result in the parish the venue names (level 1 in Jamaica)", () => {
    const pera: GeocodeResult = {
      lat: 17.89,
      lng: -76.315,
      types: ["establishment"],
      components: [comp("Pera", "locality"), comp("St. Thomas Parish", "administrative_area_level_1")],
    };
    expect(venueGeocodeRejection(pera, { location: "Bowden Wharf, St. Thomas" }, { lat: 18.0, lng: -76.79 })).toBeNull();
  });

  it("still requires the named town when the text also names the region", () => {
    expect(venueGeocodeRejection(wembdonHouse, { location: "Mount Radford, Exeter, England" }, EXETER)).toMatch(
      /outside the town/,
    );
  });

  it("lets a small level-1 area confirm a far pin (Jamaican parish)", () => {
    const draxHall: GeocodeResult = {
      lat: 18.43,
      lng: -77.17,
      types: ["establishment"],
      components: [comp("St. Ann Parish", "administrative_area_level_1"), comp("Jamaica", "country", "JM")],
    };
    expect(
      venueGeocodeRejection(draxHall, { location: "Hash Olympics, Drax Hall Beach, St. Ann" }, { lat: 18.0, lng: -76.79 }),
    ).toBeNull();
  });

  it("rejects a whole road", () => {
    const a38: GeocodeResult = {
      lat: 51.5928546,
      lng: -2.5251101,
      types: ["route"],
      components: [comp("A38", "route"), comp("England", "administrative_area_level_1"), comp("United Kingdom", "country", "GB")],
      viewportKm: 397,
    };
    expect(venueGeocodeRejection(a38, { location: "Brightside A38" }, EXETER)).toBe("a whole road, not a venue");
  });

  it("rejects a state centroid even close to the kennel", () => {
    const rhodeIsland: GeocodeResult = {
      lat: 41.5800945,
      lng: -71.4774291,
      types: ["administrative_area_level_1", "political"],
      components: [comp("Rhode Island", "administrative_area_level_1", "RI")],
    };
    expect(venueGeocodeRejection(rhodeIsland, { location: "Rhode Island" }, { lat: 41.824, lng: -71.4128 })).toMatch(
      /^an area, not a venue/,
    );
  });

  it("rejects a same-named pub in another town when the street names the right one", () => {
    const greatChishill: GeocodeResult = {
      lat: 52.0305,
      lng: 0.074,
      types: ["bar", "establishment"],
      components: [comp("Great Chishill", "locality"), comp("Royston", "postal_town"), comp("SG8 8SR", "postal_code")],
    };
    expect(
      venueGeocodeRejection(greatChishill, { location: "The Pheasant", street: "Bedford, MK41 8YR" }, BEDFORD),
    ).toMatch(/outside the town/);
  });

  it("accepts a far result in the town or postcode the venue names", () => {
    const mildenhall: GeocodeResult = {
      lat: 52.345013,
      lng: 0.522139,
      types: ["bar", "establishment"],
      components: [comp("Mildenhall", "locality"), comp("Bury Saint Edmunds", "postal_town"), comp("IP28 7HS", "postal_code")],
    };
    const cambridge = { lat: 52.2053, lng: 0.1218 };
    expect(venueGeocodeRejection(mildenhall, { location: "Half Moon", street: "Mildenhall, IP28 7HS" }, cambridge)).toBeNull();
    // A misspelt town still passes on its postcode.
    expect(venueGeocodeRejection(mildenhall, { location: "Half Moon", street: "Mildenhal, IP28 7HS" }, cambridge)).toBeNull();
  });

  it("rejects a US county centroid but keeps a district elsewhere", () => {
    const county = (country: string): GeocodeResult => ({
      lat: 26.65,
      lng: -80.27,
      types: ["administrative_area_level_2", "political"],
      components: [comp("Some County", "administrative_area_level_2"), comp(country, "country", country)],
    });
    const pbh3 = { lat: 26.7, lng: -80.1 };
    expect(venueGeocodeRejection(county("US"), { location: "Palm Beach County, FL" }, pbh3)).toMatch(/^an area/);
    expect(venueGeocodeRejection(county("TH"), { location: "Bang Lamung" }, pbh3)).toBeNull();
  });

  it("does not confirm a town from a road name or a long note", () => {
    const wrongTown: GeocodeResult = {
      lat: 52.0305,
      lng: 0.074,
      types: ["premise"],
      components: [comp("Church Road", "route"), comp("Great Chishill", "locality")],
    };
    const bedford = { lat: 52.136, lng: -0.467 };
    expect(venueGeocodeRejection(wrongTown, { location: "The Pheasant", street: "12 Church Road, Bedford" }, bedford)).toMatch(
      /outside the town/,
    );
    // A note names no place, so it can't confirm the hit (nor, alone, reject it).
    expect(venueGeocodeRejection(wrongTown, { location: "park on the verge please" }, bedford)).toBeNull();
  });

  it("accepts a far lone venue name: it names no place to check", () => {
    expect(venueGeocodeRejection(wembdonHouse, { location: "Hulu Tamu Hotsprings" }, EXETER)).toBeNull();
  });

  it("accepts a hamlet the formatted address names but the components leave out", () => {
    const dodfordInn: GeocodeResult = {
      lat: 52.355,
      lng: -2.091,
      formattedAddress: "Whinfield Rd, Dodford, Bromsgrove B61 9BG, UK",
      types: ["bar", "establishment"],
      components: [comp("Whinfield Road", "route"), comp("Bromsgrove", "postal_town")],
    };
    expect(venueGeocodeRejection(dodfordInn, { location: "Dodford Inn, Dodford" }, { lat: 52.11, lng: -2.33 })).toBeNull();
  });

  it("keeps a street-sized road even with no town component", () => {
    const parishRoad: GeocodeResult = {
      lat: 17.89,
      lng: -76.315,
      types: ["route"],
      components: [comp("Bowden Wharf Road", "route"), comp("St. Thomas Parish", "administrative_area_level_1"), comp("Jamaica", "country", "JM")],
      viewportKm: 0.4,
    };
    expect(venueGeocodeRejection(parishRoad, { location: "Bowden Wharf, St. Thomas" }, { lat: 18.0, lng: -76.79 })).toBeNull();
  });

  it.each([
    ["a misspelt town", "231 W. Fourth St., Cincinnatti", "Cincinnati"],
    ["a town written without its space", "Minburi, Tong Romklao Market", "Min Buri"],
  ])("accepts %s", (_case, location, town) => {
    const result: GeocodeResult = { lat: 39.1, lng: -84.51, types: ["premise"], components: [comp(town, "locality")] };
    expect(venueGeocodeRejection(result, { location }, { lat: 39.76, lng: -84.19 })).toBeNull();
  });

  it("rejects anything over 200 km from the kennel", () => {
    expect(venueGeocodeRejection({ lat: 53.4808, lng: -2.2426 }, { location: "Pub" }, EXETER)).toMatch(/km from the kennel$/);
  });

  it("accepts any non-area result when there is no bias point", () => {
    expect(venueGeocodeRejection(wembdonHouse, { location: "Mount Radford, Exeter" }, null)).toBeNull();
  });
});

describe("geocodeVenue", () => {
  const originalEnv = process.env.GOOGLE_CALENDAR_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env.GOOGLE_CALENDAR_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  const hit = (lat: number, lng: number, components: unknown[] = []) => ({
    status: "OK",
    results: [{ types: ["establishment"], geometry: { location: { lat, lng } }, address_components: components }],
  });

  it("returns the venue + street hit and biases toward the kennel", async () => {
    const fetchSpy = mockGeocodeResponses(hit(52.155, -0.448));

    const result = await geocodeVenue({
      location: "The Pheasant",
      street: "Bedford, MK41 8YR",
      regionBias: "gb",
      biasCenter: { lat: 52.136, lng: -0.467 },
    });

    expect(result).toMatchObject({ lat: 52.155, lng: -0.448 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(`address=${encodeURIComponent("The Pheasant, Bedford, MK41 8YR")}`);
    expect(url).toContain("&region=gb");
    expect(url).toContain("&bounds=");
  });

  it("falls back to the street line alone when venue + street finds nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = mockGeocodeResponses({ status: "ZERO_RESULTS", results: [] }, hit(52.155, -0.448));

    const result = await geocodeVenue({ location: "The Pheasant", street: "Bedford, MK41 8YR" });

    expect(result).toMatchObject({ lat: 52.155, lng: -0.448 });
    expect(fetchSpy.mock.calls[1][0]).toContain(`address=${encodeURIComponent("Bedford, MK41 8YR")}&`);
  });

  it("stops after a key or quota error instead of trying the next query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = mockGeocodeResponses({ status: "OVER_QUERY_LIMIT", results: [] });

    expect(await geocodeVenue({ location: "The Pheasant", street: "Bedford, MK41 8YR" })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("returns null when every hit is rejected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const farPub = hit(52.0305, 0.074, [comp("Great Chishill", "locality")]);
    const fetchSpy = mockGeocodeResponses(farPub, farPub);

    const result = await geocodeVenue({
      location: "The Pheasant",
      street: "Bedford, MK41 8YR",
      biasCenter: { lat: 52.136, lng: -0.467 },
    });

    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

describe("parseDMSFromLocation", () => {
  it("parses DMS coordinates from location string", () => {
    const result = parseDMSFromLocation('Fort Misery, 34°08\'52.8"N 112°22\'05.6"W, Yavapai County');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(34.1480, 3);
    expect(result!.lng).toBeCloseTo(-112.3682, 3);
  });

  it("parses comma-separated DMS coordinates", () => {
    const result = parseDMSFromLocation('37°25\'19.07"N, 122°05\'06.24"W');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(37.4220, 3);
    expect(result!.lng).toBeCloseTo(-122.0851, 3);
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

  it("strips comma-separated DMS", () => {
    const result = stripDMSFromLocation('Venue, 37°25\'19.07"N, 122°05\'06.24"W, City');
    expect(result).toBe("Venue, City");
  });

  it("returns original when no DMS present", () => {
    expect(stripDMSFromLocation("123 Main St, Phoenix, AZ")).toBe("123 Main St, Phoenix, AZ");
  });
});

describe("boundingBoxForRadiusKm", () => {
  it("is wider in longitude away from the equator", () => {
    const equator = boundingBoxForRadiusKm(0, 0, 100);
    const north = boundingBoxForRadiusKm(60, 0, 100);
    expect(equator.maxLat - equator.minLat).toBeCloseTo(north.maxLat - north.minLat, 6);
    expect(north.maxLng - north.minLng).toBeCloseTo(2 * (equator.maxLng - equator.minLng), 1);
  });

  it("contains points at the radius in every direction", () => {
    const box = boundingBoxForRadiusKm(29.95, -90.07, 150);
    for (const [lat, lng] of [[31.29, -90.07], [28.61, -90.07], [29.95, -88.52], [29.95, -91.62]]) {
      expect(haversineDistance(29.95, -90.07, lat, lng)).toBeLessThanOrEqual(150);
      expect(lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng).toBe(true);
    }
  });

  it("covers every longitude rather than wrapping at the antimeridian", () => {
    expect(boundingBoxForRadiusKm(-17.7, 179.9, 150)).toMatchObject({ minLng: -180, maxLng: 180 });
  });

  it("stays finite at the poles", () => {
    const box = boundingBoxForRadiusKm(90, 0, 50);
    expect(Number.isFinite(box.minLng) && Number.isFinite(box.maxLng)).toBe(true);
  });
});
