import { describe, it, expect } from "vitest";
import {
  regionSlug,
  regionBySlug,
  regionNameToSlug,
  allRegionOptions,
  regionAbbrev,
  regionColorClasses,
  getRegionColor,
  getRegionCentroid,
  regionTimezone,
  REGION_SEED_DATA,
} from "./region";

describe("regionSlug", () => {
  it("generates slug from region name", () => {
    expect(regionSlug("New York City, NY")).toBe("new-york-city-ny");
    expect(regionSlug("London")).toBe("london");
    expect(regionSlug("San Francisco, CA")).toBe("san-francisco-ca");
    expect(regionSlug("Washington, DC")).toBe("washington-dc");
  });
});

describe("regionBySlug", () => {
  it("returns lookup data for known slug", () => {
    const nyc = regionBySlug("new-york-city-ny");
    expect(nyc).not.toBeNull();
    expect(nyc!.name).toBe("New York City, NY");
    expect(nyc!.abbrev).toBe("NYC");
    expect(nyc!.slug).toBe("new-york-city-ny");
  });

  it("returns null for unknown slug", () => {
    expect(regionBySlug("unknown-region")).toBeNull();
  });
});

describe("regionNameToSlug", () => {
  it("resolves canonical name to slug", () => {
    expect(regionNameToSlug("New York City, NY")).toBe("new-york-city-ny");
    expect(regionNameToSlug("London")).toBe("london");
  });

  it("resolves alias to canonical slug", () => {
    expect(regionNameToSlug("London, England")).toBe("london");
    expect(regionNameToSlug("London, UK")).toBe("london");
  });

  it("returns null for unknown name", () => {
    expect(regionNameToSlug("Unknown Place")).toBeNull();
  });
});

describe("allRegionOptions", () => {
  it("returns all seed regions with slug, name, abbrev", () => {
    const options = allRegionOptions();
    expect(options.length).toBe(REGION_SEED_DATA.length);
    const nyc = options.find((o) => o.slug === "new-york-city-ny");
    expect(nyc).toEqual({ slug: "new-york-city-ny", name: "New York City, NY", abbrev: "NYC" });
  });
});

describe("slug-aware lookups", () => {
  it("regionAbbrev accepts slug", () => {
    expect(regionAbbrev("new-york-city-ny")).toBe("NYC");
    expect(regionAbbrev("london")).toBe("LDN");
  });

  it("regionAbbrev still works with name", () => {
    expect(regionAbbrev("New York City, NY")).toBe("NYC");
  });

  it("regionColorClasses accepts slug", () => {
    expect(regionColorClasses("new-york-city-ny")).toBe("bg-blue-200 text-blue-800");
  });

  it("getRegionColor accepts slug", () => {
    expect(getRegionColor("london")).toBe("#e11d48");
  });

  it("getRegionCentroid accepts slug", () => {
    const centroid = getRegionCentroid("san-francisco-ca");
    expect(centroid).toEqual({ lat: 37.77, lng: -122.42 });
  });

  it("regionTimezone accepts slug", () => {
    expect(regionTimezone("chicago-il")).toBe("America/Chicago");
    expect(regionTimezone("london")).toBe("Europe/London");
  });

  it("falls back to gray for unknown slug", () => {
    expect(regionColorClasses("fake-slug")).toBe("bg-gray-200 text-gray-800");
    expect(getRegionColor("fake-slug")).toBe("#6b7280");
    expect(getRegionCentroid("fake-slug")).toBeNull();
  });
});
