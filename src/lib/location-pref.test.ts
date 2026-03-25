import {
  resolveLocationDefault,
  getLocationPref,
  setLocationPref,
  clearLocationPref,
  type LocationPref,
} from "./location-pref";

// ---------------------------------------------------------------------------
// resolveLocationDefault — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe("resolveLocationDefault", () => {
  // -- URL params win -------------------------------------------------------

  it("returns null when URL has 'regions' param", () => {
    const params = new URLSearchParams("regions=NYC");
    const pref: LocationPref = { type: "region", name: "NYC" };
    expect(resolveLocationDefault(params, pref)).toBeNull();
  });

  it("returns null when URL has 'dist' param", () => {
    const params = new URLSearchParams("dist=25");
    const pref: LocationPref = { type: "nearMe", distance: 50 };
    expect(resolveLocationDefault(params, pref)).toBeNull();
  });

  it("returns null when URL has 'q' (search) param", () => {
    const params = new URLSearchParams("q=boston");
    const pref: LocationPref = { type: "region", name: "Boston" };
    expect(resolveLocationDefault(params, pref)).toBeNull();
  });

  it("returns null when URL has 'days' param", () => {
    const params = new URLSearchParams("days=Monday");
    const pref: LocationPref = { type: "region", name: "NYC" };
    expect(resolveLocationDefault(params, pref)).toBeNull();
  });

  it("returns null when URL has 'kennels' param", () => {
    const params = new URLSearchParams("kennels=NYCH3");
    const pref: LocationPref = { type: "region", name: "NYC" };
    expect(resolveLocationDefault(params, pref)).toBeNull();
  });

  it("returns null when URL has 'country' param", () => {
    const params = new URLSearchParams("country=UK");
    const pref: LocationPref = { type: "region", name: "London" };
    expect(resolveLocationDefault(params, pref)).toBeNull();
  });

  // -- Stored preference applied --------------------------------------------

  it("returns region default when URL is empty and region pref stored", () => {
    const params = new URLSearchParams();
    const pref: LocationPref = { type: "region", name: "NYC" };
    expect(resolveLocationDefault(params, pref)).toEqual({
      regions: ["NYC"],
    });
  });

  it("returns nearMe default when URL is empty and nearMe pref stored", () => {
    const params = new URLSearchParams();
    const pref: LocationPref = { type: "nearMe", distance: 50 };
    expect(resolveLocationDefault(params, pref)).toEqual({
      nearMeDistance: 50,
    });
  });

  it("returns null when URL is empty and no pref stored", () => {
    const params = new URLSearchParams();
    expect(resolveLocationDefault(params, null)).toBeNull();
  });

  // -- Non-filter URL params don't block pref -------------------------------

  it("applies pref when URL only has 'view' param (not a filter)", () => {
    const params = new URLSearchParams("view=map");
    const pref: LocationPref = { type: "region", name: "London" };
    expect(resolveLocationDefault(params, pref)).toEqual({
      regions: ["London"],
    });
  });

  it("applies pref when URL only has 'tab' param (not a filter)", () => {
    const params = new URLSearchParams("tab=calendar");
    const pref: LocationPref = { type: "nearMe", distance: 25 };
    expect(resolveLocationDefault(params, pref)).toEqual({
      nearMeDistance: 25,
    });
  });
});

// ---------------------------------------------------------------------------
// localStorage wrappers — mock localStorage for these thin wrappers
// ---------------------------------------------------------------------------

describe("getLocationPref / setLocationPref / clearLocationPref", () => {
  const mockStorage = new Map<string, string>();

  beforeEach(() => {
    mockStorage.clear();
    // Stub window so SSR guard (typeof window === "undefined") passes
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing is stored", () => {
    expect(getLocationPref()).toBeNull();
  });

  it("round-trips a region pref", () => {
    const pref: LocationPref = { type: "region", name: "Chicago" };
    setLocationPref(pref);
    expect(getLocationPref()).toEqual(pref);
  });

  it("round-trips a nearMe pref", () => {
    const pref: LocationPref = { type: "nearMe", distance: 100 };
    setLocationPref(pref);
    expect(getLocationPref()).toEqual(pref);
  });

  it("clearLocationPref removes the stored pref", () => {
    setLocationPref({ type: "region", name: "DC" });
    clearLocationPref();
    expect(getLocationPref()).toBeNull();
  });

  it("returns null for invalid JSON in storage", () => {
    mockStorage.set("hashtracks:locationPref", "not-json");
    expect(getLocationPref()).toBeNull();
  });

  it("returns null for valid JSON with wrong shape", () => {
    mockStorage.set(
      "hashtracks:locationPref",
      JSON.stringify({ type: "unknown", foo: "bar" }),
    );
    expect(getLocationPref()).toBeNull();
  });

  it("returns null for nearMe pref with non-number distance", () => {
    mockStorage.set(
      "hashtracks:locationPref",
      JSON.stringify({ type: "nearMe", distance: "fifty" }),
    );
    expect(getLocationPref()).toBeNull();
  });
});
